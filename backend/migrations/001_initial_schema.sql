-- YouTube Multi-Channel Streaming Service - Initial Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects table (user workspaces)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_user_id ON projects(user_id);

-- Video assets table
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    duration_seconds FLOAT,
    meta JSONB, -- video/audio parameters from ffprobe
    compatible_for_copy BOOLEAN DEFAULT FALSE,
    validation_errors TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_project_id ON assets(project_id);
CREATE INDEX idx_assets_compatible ON assets(compatible_for_copy);

-- Playlists table
CREATE TABLE IF NOT EXISTS playlists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    loop BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_playlists_project_id ON playlists(project_id);

-- Playlist items (ordered)
CREATE TABLE IF NOT EXISTS playlist_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(playlist_id, position),
    UNIQUE(playlist_id, asset_id)
);

CREATE INDEX idx_playlist_items_playlist_id ON playlist_items(playlist_id);
CREATE INDEX idx_playlist_items_position ON playlist_items(playlist_id, position);

-- YouTube channel destinations
CREATE TABLE IF NOT EXISTS destinations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rtmps_url TEXT NOT NULL DEFAULT 'rtmps://a.rtmp.youtube.com/live2',
    stream_key_encrypted TEXT NOT NULL, -- Encrypted stream key
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_destinations_project_id ON destinations(project_id);
CREATE INDEX idx_destinations_enabled ON destinations(enabled);

-- Streams table (active and historical)
CREATE TABLE IF NOT EXISTS streams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    playlist_id UUID REFERENCES playlists(id) ON DELETE RESTRICT,
    source_type TEXT DEFAULT 'playlist' NOT NULL CHECK (source_type IN ('playlist', 'assets')),
    name TEXT,
    status TEXT DEFAULT 'stopped' CHECK (status IN ('stopped', 'starting', 'running', 'error', 'stopping')),
    pid INT,
    log_path TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_streams_project_id ON streams(project_id);
CREATE INDEX idx_streams_status ON streams(status);
CREATE INDEX idx_streams_started_at ON streams(started_at);

-- Stream destinations (many-to-many)
CREATE TABLE IF NOT EXISTS stream_destinations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(stream_id, destination_id)
);

CREATE INDEX idx_stream_destinations_stream_id ON stream_destinations(stream_id);
CREATE INDEX idx_stream_destinations_destination_id ON stream_destinations(destination_id);

-- Stream events/logs table (for monitoring)
CREATE TABLE IF NOT EXISTS stream_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error', 'debug')),
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stream_events_stream_id ON stream_events(stream_id);
CREATE INDEX idx_stream_events_created_at ON stream_events(created_at DESC);
CREATE INDEX idx_stream_events_level ON stream_events(level);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assets_updated_at BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_playlists_updated_at BEFORE UPDATE ON playlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_destinations_updated_at BEFORE UPDATE ON destinations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_streams_updated_at BEFORE UPDATE ON streams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE projects IS 'User workspaces for organizing streams';
COMMENT ON TABLE assets IS 'Video files with validation metadata';
COMMENT ON TABLE playlists IS 'Ordered lists of video assets';
COMMENT ON TABLE destinations IS 'YouTube channel RTMPS endpoints';
COMMENT ON TABLE streams IS 'Active and historical streaming sessions';
COMMENT ON TABLE stream_events IS 'Stream monitoring events and logs';

COMMENT ON COLUMN assets.meta IS 'ffprobe JSON output with video/audio parameters';
COMMENT ON COLUMN assets.compatible_for_copy IS 'Whether file can be streamed with -c copy (no transcoding)';
COMMENT ON COLUMN destinations.stream_key_encrypted IS 'AES encrypted YouTube stream key';
