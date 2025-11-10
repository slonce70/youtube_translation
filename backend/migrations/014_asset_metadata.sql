-- Migration 014: Enhance asset metadata and classification

-- Add asset type classification (video | audio) and codec details
ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS asset_type TEXT,
    ADD COLUMN IF NOT EXISTS codec_info JSONB;

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
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'assets'
          AND constraint_name = 'check_asset_type'
    ) THEN
        ALTER TABLE assets
            ADD CONSTRAINT check_asset_type
            CHECK (asset_type IN ('video', 'audio'));
    END IF;
END $$;

-- Index assets by type for faster filtering
CREATE INDEX IF NOT EXISTS idx_assets_asset_type ON assets(asset_type);

-- Comment to document codec_info usage
COMMENT ON COLUMN assets.codec_info IS 'Structured codec/probe metadata (subset of ffprobe output).';
