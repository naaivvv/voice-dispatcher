import { supabase } from './supabaseClient';
import { Driver, DriverStatus } from './types';

// ============================================================
// Driver CRUD — used by the AI agent and REST endpoints
// ============================================================

/**
 * Look up a driver by their phone number.
 * This is the primary identification method when a call connects.
 */
export async function getDriverByPhone(phoneNumber: string): Promise<Driver | null> {
    const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('phone_number', phoneNumber)
        .single();

    if (error) {
        console.error('[driverService] getDriverByPhone error:', error.message);
        return null;
    }
    return data as Driver;
}

/** Retrieve a driver by UUID */
export async function getDriverById(id: string): Promise<Driver | null> {
    const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('[driverService] getDriverById error:', error.message);
        return null;
    }
    return data as Driver;
}

/** List all drivers, optionally filtered by status */
export async function listDrivers(status?: DriverStatus): Promise<Driver[]> {
    let query = supabase.from('drivers').select('*').order('name');

    if (status) {
        query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
        console.error('[driverService] listDrivers error:', error.message);
        return [];
    }
    return (data ?? []) as Driver[];
}

/** Update a driver's status (e.g. after the AI agent learns the driver is delayed) */
export async function updateDriverStatus(
    id: string,
    status: DriverStatus
): Promise<Driver | null> {
    const { data, error } = await supabase
        .from('drivers')
        .update({ status })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('[driverService] updateDriverStatus error:', error.message);
        return null;
    }
    return data as Driver;
}
