-- Migration 028: Recurring stream scheduler metadata

DO $$
BEGIN
    ALTER TABLE streams
        ADD COLUMN IF NOT EXISTS schedule_timezone TEXT,
        ADD COLUMN IF NOT EXISTS schedule_repeat TEXT NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS schedule_weekdays INTEGER[],
        ADD COLUMN IF NOT EXISTS schedule_window_end_time TIME,
        ADD COLUMN IF NOT EXISTS schedule_stop_after_seconds INTEGER;
EXCEPTION
    WHEN duplicate_column THEN
        NULL;
END $$;

ALTER TABLE streams
    DROP CONSTRAINT IF EXISTS check_stream_schedule_repeat;

ALTER TABLE streams
    ADD CONSTRAINT check_stream_schedule_repeat
    CHECK (schedule_repeat IN ('none', 'daily', 'weekly'));
