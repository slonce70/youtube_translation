-- Migration 004: Add user_id columns to existing tables
-- This migration adds user_id to assets, playlists, destinations, streams
-- and migrates data from projects table

-- Step 1: Add user_id columns (nullable initially)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE destinations ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS user_id UUID;

-- Step 2: Migrate user_id from projects table
UPDATE assets 
SET user_id = (
    SELECT user_id FROM projects WHERE projects.id = assets.project_id
)
WHERE user_id IS NULL AND project_id IS NOT NULL;

UPDATE playlists 
SET user_id = (
    SELECT user_id FROM projects WHERE projects.id = playlists.project_id
)
WHERE user_id IS NULL AND project_id IS NOT NULL;

UPDATE destinations 
SET user_id = (
    SELECT user_id FROM projects WHERE projects.id = destinations.project_id
)
WHERE user_id IS NULL AND project_id IS NOT NULL;

UPDATE streams 
SET user_id = (
    SELECT user_id FROM projects WHERE projects.id = streams.project_id
)
WHERE user_id IS NULL AND project_id IS NOT NULL;

-- Step 3: Make user_id NOT NULL and add foreign keys
-- First, delete any orphaned records (shouldn't exist, but just in case)
DELETE FROM assets WHERE user_id IS NULL;
DELETE FROM playlists WHERE user_id IS NULL;
DELETE FROM destinations WHERE user_id IS NULL;
DELETE FROM streams WHERE user_id IS NULL;

-- Now make NOT NULL
ALTER TABLE assets ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE playlists ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE destinations ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE streams ALTER COLUMN user_id SET NOT NULL;

-- Add foreign key constraints
ALTER TABLE assets 
    ADD CONSTRAINT fk_assets_user_id 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE playlists 
    ADD CONSTRAINT fk_playlists_user_id 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE destinations 
    ADD CONSTRAINT fk_destinations_user_id 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE streams 
    ADD CONSTRAINT fk_streams_user_id 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 4: Create indexes on user_id for performance
CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id);
CREATE INDEX IF NOT EXISTS idx_assets_user_created ON assets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_user_compatible ON assets(user_id, compatible_for_copy);

CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_user_created ON playlists(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_destinations_user_id ON destinations(user_id);
CREATE INDEX IF NOT EXISTS idx_destinations_user_enabled ON destinations(user_id, enabled);

CREATE INDEX IF NOT EXISTS idx_streams_user_id ON streams(user_id);
CREATE INDEX IF NOT EXISTS idx_streams_user_status ON streams(user_id, status);
CREATE INDEX IF NOT EXISTS idx_streams_user_started ON streams(user_id, started_at DESC);

-- Step 5: Add additional useful columns for tracking and analytics
ALTER TABLE assets ADD COLUMN IF NOT EXISTS video_codec TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS audio_codec TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS bitrate INTEGER;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS fps INTEGER;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'validating', 'valid', 'invalid'));

CREATE INDEX IF NOT EXISTS idx_assets_validation_status ON assets(user_id, validation_status);

ALTER TABLE playlists ADD COLUMN IF NOT EXISTS total_duration_seconds FLOAT DEFAULT 0;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS total_assets INTEGER DEFAULT 0;

ALTER TABLE destinations ADD COLUMN IF NOT EXISTS total_streams INTEGER DEFAULT 0;
ALTER TABLE destinations ADD COLUMN IF NOT EXISTS total_stream_hours FLOAT DEFAULT 0;
ALTER TABLE destinations ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_destinations_last_used ON destinations(user_id, last_used_at DESC);

ALTER TABLE streams ADD COLUMN IF NOT EXISTS total_duration_seconds FLOAT DEFAULT 0;

-- Step 6: Create functions to automatically update usage statistics

-- Function to update user storage usage
CREATE OR REPLACE FUNCTION update_user_storage_usage()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE user_profiles
        SET current_storage_bytes = (
            SELECT COALESCE(SUM(size_bytes), 0)
            FROM assets
            WHERE user_id = NEW.user_id
        )
        WHERE user_id = NEW.user_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE user_profiles
        SET current_storage_bytes = (
            SELECT COALESCE(SUM(size_bytes), 0)
            FROM assets
            WHERE user_id = OLD.user_id
        )
        WHERE user_id = OLD.user_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update storage usage when assets change
DROP TRIGGER IF EXISTS trigger_update_user_storage ON assets;
CREATE TRIGGER trigger_update_user_storage
    AFTER INSERT OR UPDATE OF size_bytes OR DELETE ON assets
    FOR EACH ROW
    EXECUTE FUNCTION update_user_storage_usage();

-- Function to update playlist statistics
CREATE OR REPLACE FUNCTION update_playlist_stats()
RETURNS TRIGGER AS $$
DECLARE
    v_playlist_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_playlist_id := OLD.playlist_id;
    ELSE
        v_playlist_id := NEW.playlist_id;
    END IF;
    
    UPDATE playlists
    SET 
        total_assets = (
            SELECT COUNT(*)
            FROM playlist_items
            WHERE playlist_id = v_playlist_id
        ),
        total_duration_seconds = (
            SELECT COALESCE(SUM(a.duration_seconds), 0)
            FROM playlist_items pi
            JOIN assets a ON a.id = pi.asset_id
            WHERE pi.playlist_id = v_playlist_id
        )
    WHERE id = v_playlist_id;
    
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update playlist stats
DROP TRIGGER IF EXISTS trigger_update_playlist_stats ON playlist_items;
CREATE TRIGGER trigger_update_playlist_stats
    AFTER INSERT OR DELETE ON playlist_items
    FOR EACH ROW
    EXECUTE FUNCTION update_playlist_stats();

-- Function to update destination usage
CREATE OR REPLACE FUNCTION update_destination_usage()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE destinations
        SET last_used_at = NOW()
        WHERE id IN (
            SELECT destination_id 
            FROM stream_destinations 
            WHERE stream_id = NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update destination last_used_at
DROP TRIGGER IF EXISTS trigger_update_destination_usage ON streams;
CREATE TRIGGER trigger_update_destination_usage
    AFTER INSERT ON streams
    FOR EACH ROW
    EXECUTE FUNCTION update_destination_usage();

-- Comments
COMMENT ON COLUMN assets.user_id IS 'Owner of the asset (migrated from projects)';
COMMENT ON COLUMN playlists.user_id IS 'Owner of the playlist (migrated from projects)';
COMMENT ON COLUMN destinations.user_id IS 'Owner of the destination (migrated from projects)';
COMMENT ON COLUMN streams.user_id IS 'Owner of the stream (migrated from projects)';
