-- ============================================================
-- Voice Dispatcher — Database Schema
-- Run this in the Supabase SQL Editor (or via psql)
-- ============================================================

-- Enable the uuid-ossp extension for uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------
-- Table: drivers
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name           TEXT        NOT NULL,
    phone_number   TEXT        NOT NULL UNIQUE,
    status         TEXT        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'on_break', 'delayed')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  drivers              IS 'Registered delivery drivers';
COMMENT ON COLUMN drivers.phone_number IS 'E.164 format — used to identify the driver when a call connects';
COMMENT ON COLUMN drivers.status       IS 'Current availability: active | on_break | delayed';

-- ----------------------------------------------------------
-- Table: deliveries
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id         UUID        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    destination       TEXT        NOT NULL,
    scheduled_time    TIMESTAMPTZ NOT NULL,
    estimated_arrival TIMESTAMPTZ,          -- Updated by the AI agent after a phone call
    status            TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'in_transit', 'completed', 'cancelled')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  deliveries                    IS 'Individual delivery assignments';
COMMENT ON COLUMN deliveries.estimated_arrival  IS 'ETA field updated by the AI voice agent';
COMMENT ON COLUMN deliveries.status             IS 'Lifecycle: pending → in_transit → completed | cancelled';

-- ----------------------------------------------------------
-- Table: dispatch_audit_log
-- Tracks all AI-driven state mutations for traceability.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatch_audit_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id    TEXT        NOT NULL,
    driver_id     UUID        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    action        TEXT        NOT NULL,
    entity_type   TEXT        NOT NULL CHECK (entity_type IN ('delivery', 'driver')),
    entity_id     UUID        NOT NULL,
    field_changed TEXT        NOT NULL,
    old_value     TEXT,
    new_value     TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  dispatch_audit_log              IS 'Audit trail for all AI-driven state changes';
COMMENT ON COLUMN dispatch_audit_log.session_id   IS 'WebSocket session that triggered the change';
COMMENT ON COLUMN dispatch_audit_log.action       IS 'Human-readable action name (e.g. update_eta, complete_delivery)';
COMMENT ON COLUMN dispatch_audit_log.entity_type  IS 'Type of entity changed: delivery or driver';

-- ----------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_drivers_phone      ON drivers             (phone_number);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver   ON deliveries          (driver_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status   ON deliveries          (status);
CREATE INDEX IF NOT EXISTS idx_audit_session       ON dispatch_audit_log  (session_id);
CREATE INDEX IF NOT EXISTS idx_audit_driver        ON dispatch_audit_log  (driver_id);
CREATE INDEX IF NOT EXISTS idx_audit_created       ON dispatch_audit_log  (created_at);

-- ----------------------------------------------------------
-- Auto-update updated_at via trigger
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

CREATE TRIGGER trg_drivers_updated_at
    BEFORE UPDATE ON drivers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_deliveries_updated_at
    BEFORE UPDATE ON deliveries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------
-- Security: Row Level Security (RLS)
-- ----------------------------------------------------------
-- Enable RLS on all tables to prevent unauthorized public API access.
-- The backend service uses the SERVICE_ROLE_KEY which bypasses RLS.
ALTER TABLE drivers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_audit_log ENABLE ROW LEVEL SECURITY;

-- Note: No public policies are added, meaning all public access via anon/authenticated 
-- keys is denied by default. Access is restricted to the service role.

-- ----------------------------------------------------------
-- Seed data (for development / testing)
-- ----------------------------------------------------------
INSERT INTO drivers (name, phone_number, status) VALUES
    ('Carlos Rivera',  '+15551234567', 'active'),
    ('Maria Santos',   '+15559876543', 'active'),
    ('James O''Brien', '+15555550100', 'on_break')
ON CONFLICT (phone_number) DO NOTHING;

-- Grab driver IDs for seeding deliveries
DO $$
DECLARE
    v_carlos UUID;
    v_maria  UUID;
BEGIN
    SELECT id INTO v_carlos FROM drivers WHERE phone_number = '+15551234567';
    SELECT id INTO v_maria  FROM drivers WHERE phone_number = '+15559876543';

    INSERT INTO deliveries (driver_id, destination, scheduled_time, estimated_arrival, status) VALUES
        (v_carlos, '123 Main St, Springfield',    now() + INTERVAL '1 hour',  now() + INTERVAL '1 hour',    'in_transit'),
        (v_carlos, '456 Oak Ave, Shelbyville',    now() + INTERVAL '3 hours', now() + INTERVAL '3 hours',   'pending'),
        (v_maria,  '789 Pine Rd, Capital City',   now() + INTERVAL '2 hours', now() + INTERVAL '2.5 hours', 'in_transit')
    ON CONFLICT DO NOTHING;
END $$;
