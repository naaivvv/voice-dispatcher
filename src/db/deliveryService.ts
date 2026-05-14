import { supabase } from './supabaseClient';
import { Delivery, DeliveryStatus, DeliveryWithDriver } from './types';

// ============================================================
// Delivery CRUD — used by the AI agent and REST endpoints
// ============================================================

/**
 * Get active deliveries for a driver (pending or in_transit).
 * The AI agent calls this after identifying the driver to understand
 * what deliveries are in play before asking about ETA.
 */
export async function getActiveDeliveriesForDriver(
    driverId: string
): Promise<Delivery[]> {
    const { data, error } = await supabase
        .from('deliveries')
        .select('*')
        .eq('driver_id', driverId)
        .in('status', ['pending', 'in_transit'])
        .order('scheduled_time', { ascending: true });

    if (error) {
        console.error('[deliveryService] getActiveDeliveriesForDriver error:', error.message);
        return [];
    }
    return (data ?? []) as Delivery[];
}

/** Retrieve a single delivery by ID */
export async function getDeliveryById(id: string): Promise<Delivery | null> {
    const { data, error } = await supabase
        .from('deliveries')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('[deliveryService] getDeliveryById error:', error.message);
        return null;
    }
    return data as Delivery;
}

/**
 * Update the estimated arrival time for a delivery.
 * ★ This is the primary action the AI agent performs after a call. ★
 */
export async function updateEstimatedArrival(
    deliveryId: string,
    estimatedArrival: Date
): Promise<Delivery | null> {
    const { data, error } = await supabase
        .from('deliveries')
        .update({ estimated_arrival: estimatedArrival.toISOString() })
        .eq('id', deliveryId)
        .select()
        .single();

    if (error) {
        console.error('[deliveryService] updateEstimatedArrival error:', error.message);
        return null;
    }
    return data as Delivery;
}

/** Update delivery status (e.g. pending → in_transit → completed) */
export async function updateDeliveryStatus(
    deliveryId: string,
    status: DeliveryStatus
): Promise<Delivery | null> {
    const { data, error } = await supabase
        .from('deliveries')
        .update({ status })
        .eq('id', deliveryId)
        .select()
        .single();

    if (error) {
        console.error('[deliveryService] updateDeliveryStatus error:', error.message);
        return null;
    }
    return data as Delivery;
}

/** Get all deliveries with driver info, filtered by status */
export async function listDeliveriesWithDriver(
    status?: DeliveryStatus
): Promise<DeliveryWithDriver[]> {
    let query = supabase
        .from('deliveries')
        .select('*, driver:drivers(id, name, phone_number, status)')
        .order('scheduled_time', { ascending: true });

    if (status) {
        query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
        console.error('[deliveryService] listDeliveriesWithDriver error:', error.message);
        return [];
    }
    return (data ?? []) as DeliveryWithDriver[];
}
