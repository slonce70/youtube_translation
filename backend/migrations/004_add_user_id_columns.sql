-- Migration 004: Additional indexes (LOCAL VERSION)
-- user_id columns and FK constraints already created in 000_local_initial_schema.sql

-- Only create additional composite indexes not in 000
CREATE INDEX IF NOT EXISTS idx_assets_user_created ON assets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_user_compatible ON assets(user_id, compatible_for_copy);

CREATE INDEX IF NOT EXISTS idx_playlists_user_created ON playlists(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_destinations_user_enabled ON destinations(user_id, enabled);

CREATE INDEX IF NOT EXISTS idx_streams_user_status ON streams(user_id, status);
CREATE INDEX IF NOT EXISTS idx_streams_user_started ON streams(user_id, started_at DESC);

-- Additional asset columns for tracking
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

-- Functions for automatic statistics updates
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

DROP TRIGGER IF EXISTS trigger_update_user_storage ON assets;
CREATE TRIGGER trigger_update_user_storage
    AFTER INSERT OR UPDATE OF size_bytes OR DELETE ON assets
    FOR EACH ROW
    EXECUTE FUNCTION update_user_storage_usage();

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

DROP TRIGGER IF EXISTS trigger_update_playlist_stats ON playlist_items;
CREATE TRIGGER trigger_update_playlist_stats
    AFTER INSERT OR DELETE ON playlist_items
    FOR EACH ROW
    EXECUTE FUNCTION update_playlist_stats();

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

DROP TRIGGER IF EXISTS trigger_update_destination_usage ON streams;
CREATE TRIGGER trigger_update_destination_usage
    AFTER INSERT ON streams
    FOR EACH ROW
    EXECUTE FUNCTION update_destination_usage();
