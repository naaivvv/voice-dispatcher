// ============================================================
// Database row types for the voice-dispatcher schema
// ============================================================

export type DriverStatus = 'active' | 'on_break' | 'delayed';

export type DeliveryStatus = 'pending' | 'in_transit' | 'completed' | 'cancelled';

/** Row shape returned from the `drivers` table */
export interface Driver {
    id: string;
    name: string;
    phone_number: string;
    status: DriverStatus;
    created_at: string;
    updated_at: string;
}

/** Row shape returned from the `deliveries` table */
export interface Delivery {
    id: string;
    driver_id: string;
    destination: string;
    scheduled_time: string;
    estimated_arrival: string | null;
    status: DeliveryStatus;
    created_at: string;
    updated_at: string;
}

/** Delivery joined with its driver info */
export interface DeliveryWithDriver extends Delivery {
    driver: Pick<Driver, 'id' | 'name' | 'phone_number' | 'status'>;
}
