-- Migration 030: Add runtime lease ownership metadata for multi-node safety

DO $$
BEGIN
    ALTER TABLE streams
        ADD COLUMN IF NOT EXISTS runtime_owner_id TEXT,
        ADD COLUMN IF NOT EXISTS runtime_lease_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS runtime_last_heartbeat_at TIMESTAMPTZ;
EXCEPTION
    WHEN duplicate_column THEN
        NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_streams_runtime_owner_id
    ON streams(runtime_owner_id);

CREATE INDEX IF NOT EXISTS idx_streams_runtime_lease_expires_at
    ON streams(runtime_lease_expires_at);
