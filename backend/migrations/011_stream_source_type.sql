-- Migration 011: Stream source type support
-- Adds source_type column and relaxes playlist_id requirement

-- Ensure source_type column exists with playlist default
ALTER TABLE streams
    ADD COLUMN IF NOT EXISTS source_type TEXT;

UPDATE streams
SET source_type = 'playlist'
WHERE source_type IS NULL;

ALTER TABLE streams
    ALTER COLUMN source_type SET DEFAULT 'playlist';

ALTER TABLE streams
    ALTER COLUMN source_type SET NOT NULL;

-- Add check constraint if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'streams'
          AND constraint_name = 'check_source_type'
    ) THEN
        ALTER TABLE streams
            ADD CONSTRAINT check_source_type
            CHECK (source_type IN ('playlist', 'assets'));
    END IF;
END $$;

-- Allow asset-based streams without playlist
ALTER TABLE streams
    ALTER COLUMN playlist_id DROP NOT NULL;
