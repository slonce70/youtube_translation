-- Migration 024: Add scheduled stop metadata for streams

DO $$
BEGIN
    ALTER TABLE streams
        ADD COLUMN IF NOT EXISTS scheduled_stop_time TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS scheduled_stop_attempted_at TIMESTAMPTZ;
EXCEPTION
    WHEN duplicate_column THEN
        NULL;
END $$;
