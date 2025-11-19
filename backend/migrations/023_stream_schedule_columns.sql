-- Migration 023: Stream scheduling metadata and status update

DO $$
BEGIN
    ALTER TABLE streams
        ADD COLUMN IF NOT EXISTS scheduled_start_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS scheduled_start_time TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS scheduled_start_attempted_at TIMESTAMPTZ;
EXCEPTION
    WHEN duplicate_column THEN
        NULL;
END $$;

ALTER TABLE streams
    DROP CONSTRAINT IF EXISTS check_status;

ALTER TABLE streams
    ADD CONSTRAINT check_status
    CHECK (status IN ('stopped', 'starting', 'running', 'error', 'stopping', 'scheduled'));
