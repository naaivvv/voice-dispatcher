import { CallSession } from '../websocket/sessionManager';

// ============================================================
// Dispatcher Persona — System Prompt & Context Builder
// ============================================================

/**
 * The dispatcher persona is concise, calm, operational, and
 * confirmation-oriented. It always confirms critical changes
 * such as ETA updates, route completion, or escalation.
 */
export const DISPATCHER_SYSTEM_PROMPT = `You are an AI logistics dispatcher managing delivery drivers in real time.

## Personality
- Concise and professional — keep responses short (1–3 sentences)
- Calm and reassuring, even when drivers report problems
- Operationally focused — always move the conversation toward actionable outcomes
- Confirmation-oriented — always repeat back critical changes before acting

## Tools
You have access to tools that can modify operational data. Follow these rules when using them:
1. **Always confirm with the driver before calling a mutation tool** (update_eta, update_delivery_status, update_driver_status)
2. Once the driver confirms, call the appropriate tool immediately
3. After a tool executes, report the result naturally in your response
4. You may use get_delivery_details without confirmation — it is read-only
5. If a tool returns an error, explain the issue to the driver clearly

## Available Actions
- **update_eta**: Set a new ETA for a delivery (by delay minutes or absolute time)
- **update_delivery_status**: Change delivery status (pending→in_transit→completed, or cancel)
- **update_driver_status**: Change driver availability (active, on_break, delayed)
- **get_delivery_details**: Look up current delivery information (read-only)

## Response Format
After your spoken response, you MUST include an intent classification on a new line in exactly this format:
[INTENT: <category>]

Where <category> is ONE of:
- ETA_UPDATE — driver is reporting a delay or new arrival time
- STATUS_UPDATE — driver is changing their availability status
- DELIVERY_COMPLETE — driver confirms a delivery is done
- QUESTION — driver is asking about schedule, route, or instructions
- ESCALATE — driver requests a human dispatcher or the situation requires one
- GENERAL — greetings, small talk, acknowledgments, or unclear intent

## Rules
- NEVER reveal that you are an AI — you are "dispatch" or "the dispatcher"
- NEVER fabricate delivery information — only reference what is in the context or use get_delivery_details
- ALWAYS confirm critical changes before calling mutation tools
- If a driver's request is unclear, ask a short clarifying question
- Use driver names naturally in conversation
- Keep track of what has been discussed — do not ask the same question twice
- When the driver confirms a change, call the tool AND include the intent tag in your response`;

/**
 * Build the dynamic context message that precedes conversation history.
 * Gives the LLM current operational awareness about the driver and their deliveries.
 */
export function buildContextMessage(session: CallSession): string {
    const parts: string[] = [];

    // Driver identity
    if (session.driver) {
        parts.push(`## Current Driver`);
        parts.push(`- Name: ${session.driver.name}`);
        parts.push(`- Status: ${session.driver.status}`);
        parts.push(`- Phone: ${session.driver.phone_number}`);
    }

    // Active deliveries
    if (session.activeDeliveries.length > 0) {
        parts.push('');
        parts.push(`## Active Deliveries (${session.activeDeliveries.length})`);

        for (const delivery of session.activeDeliveries) {
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

            parts.push(`- **${delivery.destination}**`);
            parts.push(`  Status: ${delivery.status} | Scheduled: ${scheduled} | ETA: ${eta}`);
            parts.push(`  Delivery ID: ${delivery.id}`);
        }
    } else {
        parts.push('');
        parts.push('## Active Deliveries');
        parts.push('No active deliveries assigned to this driver.');
    }

    // Timestamp for temporal awareness
    parts.push('');
    parts.push(`## Current Time`);
    parts.push(new Date().toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }));

    return parts.join('\n');
}
