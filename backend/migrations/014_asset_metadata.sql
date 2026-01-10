-- Migration 014: Enhance asset metadata and classification

-- Add asset type classification (video | audio | image) and codec details
ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS asset_type TEXT,
    ADD COLUMN IF NOT EXISTS codec_info JSONB,
    ADD COLUMN IF NOT EXISTS video_codec TEXT,
    ADD COLUMN IF NOT EXISTS audio_codec TEXT,
    ADD COLUMN IF NOT EXISTS resolution TEXT,
    ADD COLUMN IF NOT EXISTS bitrate INTEGER,
    ADD COLUMN IF NOT EXISTS fps INTEGER,
    ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'pending';

-- Backfill asset_type for existing records and enforce defaults
UPDATE assets
SET asset_type = COALESCE(asset_type, 'video')
WHERE asset_type IS NULL;

ALTER TABLE assets
    ALTER COLUMN asset_type SET DEFAULT 'video';

ALTER TABLE assets
    ALTER COLUMN asset_type SET NOT NULL;

-- Create a check constraint if it does not already exist
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'assets'
          AND constraint_name = 'check_asset_type'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = 'assets'
              AND c.conname = 'check_asset_type'
              AND pg_get_constraintdef(c.oid) ILIKE '%image%'
        ) THEN
            ALTER TABLE assets DROP CONSTRAINT check_asset_type;
            ALTER TABLE assets
                ADD CONSTRAINT check_asset_type
                CHECK (asset_type IN ('video', 'audio', 'image'));
        END IF;
    ELSE
        ALTER TABLE assets
            ADD CONSTRAINT check_asset_type
            CHECK (asset_type IN ('video', 'audio', 'image'));
    END IF;
END $$;

-- Index assets by type for faster filtering
CREATE INDEX IF NOT EXISTS idx_assets_asset_type ON assets(asset_type);

-- Comment to document codec_info usage
COMMENT ON COLUMN assets.codec_info IS 'Structured codec/probe metadata (subset of ffprobe output).';
