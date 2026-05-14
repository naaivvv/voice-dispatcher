import { supabase } from './supabaseClient';

// ============================================================
// Audit Service — logs all AI-driven state mutations
// ============================================================

export interface AuditLogEntry {
    id?: string;
    session_id: string;
    driver_id: string;
    action: string;
    entity_type: 'delivery' | 'driver';
    entity_id: string;
    field_changed: string;
    old_value: string | null;
    new_value: string;
    created_at?: string;
}

/**
 * Record an audit log entry for any AI-driven state mutation.
 * Every change the dispatcher agent makes to operational data
 * goes through this function for traceability.
 */
export async function createAuditLog(
    entry: Omit<AuditLogEntry, 'id' | 'created_at'>
): Promise<AuditLogEntry | null> {
    const { data, error } = await supabase
        .from('dispatch_audit_log')
        .insert({
            session_id: entry.session_id,
            driver_id: entry.driver_id,
            action: entry.action,
            entity_type: entry.entity_type,
            entity_id: entry.entity_id,
            field_changed: entry.field_changed,
            old_value: entry.old_value,
            new_value: entry.new_value,
        })
        .select()
        .single();

    if (error) {
        // Audit failures should not block operations — log and continue
        console.error('[auditService] Failed to create audit log:', error.message);
        return null;
    }

    console.log(
        `[auditService] Logged: ${entry.action} on ${entry.entity_type}/${entry.entity_id} ` +
        `(${entry.field_changed}: ${entry.old_value ?? 'null'} → ${entry.new_value})`
    );

    return data as AuditLogEntry;
}

/**
 * Get audit history for a specific session.
 */
export async function getAuditLogsBySession(
    sessionId: string
): Promise<AuditLogEntry[]> {
    const { data, error } = await supabase
        .from('dispatch_audit_log')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[auditService] getAuditLogsBySession error:', error.message);
        return [];
    }
    return (data ?? []) as AuditLogEntry[];
}

/**
 * Get audit history for a specific driver.
 */
export async function getAuditLogsByDriver(
    driverId: string
): Promise<AuditLogEntry[]> {
    const { data, error } = await supabase
        .from('dispatch_audit_log')
        .select('*')
        .eq('driver_id', driverId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[auditService] getAuditLogsByDriver error:', error.message);
        return [];
    }
    return (data ?? []) as AuditLogEntry[];
}
