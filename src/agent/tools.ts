import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import {
    getDeliveryById,
    updateEstimatedArrival,
    updateDeliveryStatus,
    getActiveDeliveriesForDriver,
} from '../db/deliveryService';
import { updateDriverStatus, getDriverById } from '../db/driverService';
import { createAuditLog } from '../db/auditService';
import { DeliveryStatus, DriverStatus } from '../db/types';
import { sessionManager } from '../websocket/sessionManager';

// ============================================================
// LangChain Tools — AI-controlled backend actions
//
// Each tool wraps a DB service function with:
//   1. Input validation via Zod schemas
//   2. Pre-mutation state capture (for audit logging)
//   3. Audit log creation after successful mutation
//   4. Session state refresh so context stays current
// ============================================================

/**
 * Tracks which tools were called during a single orchestrator turn.
 * The orchestrator reads and clears this after each processDriverMessage().
 */
export interface ToolExecutionRecord {
    tool: string;
    input: Record<string, unknown>;
    result: string;
    timestamp: Date;
}

let pendingExecutions: ToolExecutionRecord[] = [];

export function drainToolExecutions(): ToolExecutionRecord[] {
    const records = [...pendingExecutions];
    pendingExecutions = [];
    return records;
}

function recordExecution(name: string, input: Record<string, unknown>, result: string): void {
    pendingExecutions.push({ tool: name, input, result, timestamp: new Date() });
}

// ── Helper: refresh session deliveries after mutation ───────
async function refreshSessionDeliveries(sessionId: string): Promise<void> {
    const session = sessionManager.getSession(sessionId);
    if (session?.driver) {
        session.activeDeliveries = await getActiveDeliveriesForDriver(session.driver.id);
    }
}

// ── Helper: compute new ETA from delay minutes ─────────────
function computeNewEta(currentEta: string | null, delayMinutes: number): Date {
    const base = currentEta ? new Date(currentEta) : new Date();
    return new Date(base.getTime() + delayMinutes * 60_000);
}

// ============================================================
// Tool: Update ETA
// ============================================================
export const updateEtaTool = tool(
    async (input) => {
        const delivery = await getDeliveryById(input.delivery_id);
        if (!delivery) {
            return `Error: Delivery ${input.delivery_id} not found.`;
        }

        const oldEta = delivery.estimated_arrival;
        let newEtaDate: Date;

        if (input.delay_minutes !== undefined) {
            newEtaDate = computeNewEta(delivery.estimated_arrival, input.delay_minutes);
        } else if (input.new_eta) {
            newEtaDate = new Date(input.new_eta);
            if (isNaN(newEtaDate.getTime())) {
                return `Error: Invalid date format for new_eta: "${input.new_eta}"`;
            }
        } else {
            return 'Error: Provide either delay_minutes or new_eta.';
        }

        const updated = await updateEstimatedArrival(delivery.id, newEtaDate);
        if (!updated) {
            return `Error: Failed to update ETA for delivery ${input.delivery_id}.`;
        }

        // Audit log
        await createAuditLog({
            session_id: input.session_id,
            driver_id: delivery.driver_id,
            action: 'update_eta',
            entity_type: 'delivery',
            entity_id: delivery.id,
            field_changed: 'estimated_arrival',
            old_value: oldEta,
            new_value: newEtaDate.toISOString(),
        });

        // Refresh session context
        await refreshSessionDeliveries(input.session_id);

        const formattedEta = newEtaDate.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });

        const result = `ETA updated for delivery to ${delivery.destination}. New ETA: ${formattedEta}.`;
        recordExecution('update_eta', input as Record<string, unknown>, result);
        return result;
    },
    {
        name: 'update_eta',
        description:
            'Update the estimated arrival time for a delivery. Use delay_minutes to add a delay relative to the current ETA, or new_eta to set an absolute time. Always confirm with the driver before calling this.',
        schema: z.object({
            session_id: z.string().describe('The current WebSocket session ID'),
            delivery_id: z.string().describe('UUID of the delivery to update'),
            delay_minutes: z
                .number()
                .optional()
                .describe('Minutes to add to the current ETA (e.g., 20 for a 20-minute delay)'),
            new_eta: z
                .string()
                .optional()
                .describe('Absolute ISO-8601 datetime for the new ETA (alternative to delay_minutes)'),
        }),
    }
);

// ============================================================
// Tool: Update Delivery Status
// ============================================================
export const updateDeliveryStatusTool = tool(
    async (input) => {
        const delivery = await getDeliveryById(input.delivery_id);
        if (!delivery) {
            return `Error: Delivery ${input.delivery_id} not found.`;
        }

        const oldStatus = delivery.status;
        const newStatus = input.status as DeliveryStatus;

        // Validate status transition
        const validTransitions: Record<string, string[]> = {
            pending: ['in_transit', 'cancelled'],
            in_transit: ['completed', 'cancelled'],
            completed: [],
            cancelled: [],
        };

        if (!validTransitions[oldStatus]?.includes(newStatus)) {
            return `Error: Cannot transition delivery from "${oldStatus}" to "${newStatus}". Valid transitions: ${validTransitions[oldStatus]?.join(', ') || 'none'}.`;
        }

        const updated = await updateDeliveryStatus(delivery.id, newStatus);
        if (!updated) {
            return `Error: Failed to update delivery status.`;
        }

        await createAuditLog({
            session_id: input.session_id,
            driver_id: delivery.driver_id,
            action: `delivery_${newStatus}`,
            entity_type: 'delivery',
            entity_id: delivery.id,
            field_changed: 'status',
            old_value: oldStatus,
            new_value: newStatus,
        });

        await refreshSessionDeliveries(input.session_id);

        const result = `Delivery to ${delivery.destination} marked as ${newStatus}.`;
        recordExecution('update_delivery_status', input as Record<string, unknown>, result);
        return result;
    },
    {
        name: 'update_delivery_status',
        description:
            'Update the status of a delivery. Valid transitions: pending→in_transit, pending→cancelled, in_transit→completed, in_transit→cancelled. Always confirm with the driver before marking a delivery as completed.',
        schema: z.object({
            session_id: z.string().describe('The current WebSocket session ID'),
            delivery_id: z.string().describe('UUID of the delivery to update'),
            status: z
                .enum(['pending', 'in_transit', 'completed', 'cancelled'])
                .describe('The new delivery status'),
        }),
    }
);

// ============================================================
// Tool: Update Driver Status
// ============================================================
export const updateDriverStatusTool = tool(
    async (input) => {
        const driver = await getDriverById(input.driver_id);
        if (!driver) {
            return `Error: Driver ${input.driver_id} not found.`;
        }

        const oldStatus = driver.status;
        const newStatus = input.status as DriverStatus;

        if (oldStatus === newStatus) {
            return `Driver ${driver.name} is already ${newStatus}. No change needed.`;
        }

        const updated = await updateDriverStatus(driver.id, newStatus);
        if (!updated) {
            return `Error: Failed to update driver status.`;
        }

        await createAuditLog({
            session_id: input.session_id,
            driver_id: driver.id,
            action: `driver_status_${newStatus}`,
            entity_type: 'driver',
            entity_id: driver.id,
            field_changed: 'status',
            old_value: oldStatus,
            new_value: newStatus,
        });

        // Update the session's driver object so context stays current
        const session = sessionManager.getSession(input.session_id);
        if (session?.driver) {
            session.driver.status = newStatus;
        }

        const result = `Driver ${driver.name} status updated from ${oldStatus} to ${newStatus}.`;
        recordExecution('update_driver_status', input as Record<string, unknown>, result);
        return result;
    },
    {
        name: 'update_driver_status',
        description:
            'Update a driver\'s availability status. Use when a driver reports they are going on break, coming back active, or experiencing a delay. Always confirm with the driver first.',
        schema: z.object({
            session_id: z.string().describe('The current WebSocket session ID'),
            driver_id: z.string().describe('UUID of the driver to update'),
            status: z
                .enum(['active', 'on_break', 'delayed'])
                .describe('The new driver status'),
        }),
    }
);

// ============================================================
// Tool: Get Delivery Details
// ============================================================
export const getDeliveryDetailsTool = tool(
    async (input) => {
        const delivery = await getDeliveryById(input.delivery_id);
        if (!delivery) {
            return `Error: Delivery ${input.delivery_id} not found.`;
        }

        const eta = delivery.estimated_arrival
            ? new Date(delivery.estimated_arrival).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            })
            : 'not set';
        const scheduled = new Date(delivery.scheduled_time).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });

        return [
            `Delivery to ${delivery.destination}:`,
            `  Status: ${delivery.status}`,
            `  Scheduled: ${scheduled}`,
            `  Current ETA: ${eta}`,
            `  ID: ${delivery.id}`,
        ].join('\n');
    },
    {
        name: 'get_delivery_details',
        description:
            'Look up the current details of a specific delivery including status, scheduled time, and ETA. Use this when you need to check a delivery before making changes.',
        schema: z.object({
            delivery_id: z.string().describe('UUID of the delivery to look up'),
        }),
    }
);

/** All dispatcher tools bundled for the orchestrator */
export const dispatcherTools = [
    updateEtaTool,
    updateDeliveryStatusTool,
    updateDriverStatusTool,
    getDeliveryDetailsTool,
];
