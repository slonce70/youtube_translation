-- Local PostgreSQL Initial Schema
-- This replaces 001_initial_schema.sql for local development without Supabase Auth

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User profiles table (replaces auth.users for local DB)
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    company_name TEXT,
    
    -- Subscription info
    subscription_tier TEXT NOT NULL DEFAULT 'free' 
        CHECK (subscription_tier IN ('free', 'fhd_start', 'fhd_flow', 'fhd_boost', 'uhd_start', 'uhd_flow', 'uhd_boost', 'pro', 'business', 'enterprise')),
    subscription_status TEXT NOT NULL DEFAULT 'active'
        CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'suspended')),
    subscription_started_at TIMESTAMPTZ DEFAULT NOW(),
    subscription_expires_at TIMESTAMPTZ,
    
    -- Payment integration (Stripe)
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    
    -- Usage tracking
    current_storage_bytes BIGINT DEFAULT 0,
    total_stream_hours FLOAT DEFAULT 0,
    
    -- Admin flags
    is_admin BOOLEAN DEFAULT FALSE,
    is_suspended BOOLEAN DEFAULT FALSE,
    suspension_reason TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Indexes for user_profiles
CREATE INDEX idx_user_profiles_tier ON user_profiles(subscription_tier);
CREATE INDEX idx_user_profiles_status ON user_profiles(subscription_status);
CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_admin ON user_profiles(is_admin) WHERE is_admin = TRUE;
CREATE INDEX idx_user_profiles_suspended ON user_profiles(is_suspended) WHERE is_suspended = TRUE;
CREATE INDEX idx_user_profiles_stripe_customer ON user_profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Subscription tier limits table
CREATE TABLE IF NOT EXISTS subscription_tier_limits (
    tier TEXT PRIMARY KEY CHECK (tier IN ('free', 'fhd_start', 'fhd_flow', 'fhd_boost', 'uhd_start', 'uhd_flow', 'uhd_boost', 'pro', 'business', 'enterprise')),
    
    -- Storage limits
    storage_gb INTEGER,  -- NULL = unlimited
    
    -- Streaming limits
    max_concurrent_streams INTEGER,  -- NULL = unlimited
    max_destinations INTEGER,  -- NULL = unlimited
    max_playlists INTEGER,  -- NULL = unlimited
    max_assets INTEGER,  -- NULL = unlimited
    
    -- Quality limits
    max_resolution_height INTEGER,  -- e.g., 1080, 2160
    max_fps INTEGER,  -- e.g., 30, 60
    max_video_bitrate_mbps FLOAT,  -- Maximum bitrate in Mbps
    min_video_bitrate_mbps FLOAT,  -- Minimum bitrate in Mbps
    enforce_stream_quality BOOLEAN DEFAULT TRUE,
    
    -- Feature flags
    max_resolution TEXT NOT NULL DEFAULT '1080p',
    api_access_enabled BOOLEAN DEFAULT FALSE,
    custom_rtmps_enabled BOOLEAN DEFAULT FALSE,
    analytics_enabled BOOLEAN DEFAULT FALSE,
    team_collaboration_enabled BOOLEAN DEFAULT FALSE,
    
    -- Pricing
    price_cents INTEGER NOT NULL DEFAULT 0,  -- Monthly price in cents
    
    -- Retention
    log_retention_days INTEGER DEFAULT 7,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video assets table
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    duration_seconds FLOAT,
    meta JSONB,
    compatible_for_copy BOOLEAN DEFAULT FALSE,
    validation_errors TEXT[],
    
    -- Media metadata
    media_type TEXT DEFAULT 'video' CHECK (media_type IN ('video', 'audio', 'image')),
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    
    -- Folder organization
    folder_id UUID,  -- Will add FK after media_folders table is created
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_user_id ON assets(user_id);
CREATE INDEX idx_assets_compatible ON assets(compatible_for_copy);
CREATE INDEX idx_assets_folder_id ON assets(folder_id);

-- Playlists table
CREATE TABLE IF NOT EXISTS playlists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    loop BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_playlists_user_id ON playlists(user_id);

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
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rtmps_url TEXT NOT NULL DEFAULT 'rtmps://a.rtmps.youtube.com/live2',
    stream_key_encrypted TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_destinations_user_id ON destinations(user_id);
CREATE INDEX idx_destinations_enabled ON destinations(enabled);

-- Streams table (active and historical)
CREATE TABLE IF NOT EXISTS streams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    playlist_id UUID REFERENCES playlists(id) ON DELETE RESTRICT,
    source_type TEXT DEFAULT 'playlist' NOT NULL CHECK (source_type IN ('playlist', 'assets')),
    name TEXT,
    status TEXT DEFAULT 'stopped' CHECK (status IN ('stopped', 'starting', 'running', 'error', 'stopping', 'scheduled')),
    pid INT,
    log_path TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    
    -- Collection link
    collection_id UUID,  -- Will add FK after media_collections table is created
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_streams_user_id ON streams(user_id);
CREATE INDEX idx_streams_status ON streams(status);
CREATE INDEX idx_streams_started_at ON streams(started_at);
CREATE INDEX idx_streams_collection_id ON streams(collection_id);

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

-- Stream assets (many-to-many for source_type='assets')
CREATE TABLE IF NOT EXISTS stream_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stream_assets_stream_id ON stream_assets(stream_id);
CREATE INDEX idx_stream_assets_asset_id ON stream_assets(asset_id);
CREATE INDEX idx_stream_assets_stream_position ON stream_assets(stream_id, position);

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

-- Media folders table
CREATE TABLE IF NOT EXISTS media_folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_id UUID REFERENCES media_folders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, parent_id, name)
);

CREATE INDEX idx_media_folders_user_id ON media_folders(user_id);
CREATE INDEX idx_media_folders_parent_id ON media_folders(parent_id);

-- Media collections table
CREATE TABLE IF NOT EXISTS media_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_media_collections_user_id ON media_collections(user_id);

-- Collection items (many-to-many between assets and collections)
CREATE TABLE IF NOT EXISTS collection_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID NOT NULL REFERENCES media_collections(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(collection_id, asset_id),
    UNIQUE(collection_id, position)
);

CREATE INDEX idx_collection_items_collection_id ON collection_items(collection_id);
CREATE INDEX idx_collection_items_asset_id ON collection_items(asset_id);

-- Admin tables
CREATE TABLE IF NOT EXISTS admin_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    target_user_id UUID REFERENCES user_profiles(user_id) ON DELETE SET NULL,
    action_type TEXT NOT NULL CHECK (action_type IN (
        'user_suspended', 'user_unsuspended', 'tier_changed', 
        'storage_increased', 'feature_granted', 'feature_revoked',
        'system_alert_created', 'system_alert_resolved'
    )),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_admin_actions_admin_user ON admin_actions(admin_user_id);
CREATE INDEX idx_admin_actions_target_user ON admin_actions(target_user_id);
CREATE INDEX idx_admin_actions_type ON admin_actions(action_type);
CREATE INDEX idx_admin_actions_created_at ON admin_actions(created_at DESC);

CREATE TABLE IF NOT EXISTS system_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'storage_warning', 'storage_exceeded', 'stream_limit_reached',
        'subscription_expiring', 'subscription_expired', 'payment_failed',
        'system_maintenance', 'feature_announcement'
    )),
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    message TEXT NOT NULL,
    details JSONB,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_by UUID REFERENCES user_profiles(user_id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_system_alerts_user_id ON system_alerts(user_id);
CREATE INDEX idx_system_alerts_type ON system_alerts(alert_type);
CREATE INDEX idx_system_alerts_severity ON system_alerts(severity);
CREATE INDEX idx_system_alerts_resolved ON system_alerts(resolved) WHERE NOT resolved;
CREATE INDEX idx_system_alerts_created_at ON system_alerts(created_at DESC);

CREATE TABLE IF NOT EXISTS user_activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_activity_log_user_id ON user_activity_log(user_id);
CREATE INDEX idx_user_activity_log_type ON user_activity_log(activity_type);
CREATE INDEX idx_user_activity_log_created_at ON user_activity_log(created_at DESC);

-- Add foreign key constraints for folder_id and collection_id
ALTER TABLE assets ADD CONSTRAINT fk_assets_folder_id 
    FOREIGN KEY (folder_id) REFERENCES media_folders(id) ON DELETE SET NULL;

ALTER TABLE streams ADD CONSTRAINT fk_streams_collection_id 
    FOREIGN KEY (collection_id) REFERENCES media_collections(id) ON DELETE SET NULL;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assets_updated_at BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_playlists_updated_at BEFORE UPDATE ON playlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_destinations_updated_at BEFORE UPDATE ON destinations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_streams_updated_at BEFORE UPDATE ON streams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_media_folders_updated_at BEFORE UPDATE ON media_folders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_media_collections_updated_at BEFORE UPDATE ON media_collections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stream_assets_updated_at BEFORE UPDATE ON stream_assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default tier limits
INSERT INTO subscription_tier_limits (
    tier, 
    storage_gb, 
    max_concurrent_streams, 
    max_destinations, 
    max_playlists, 
    max_assets,
    max_resolution_height,
    max_fps,
    max_video_bitrate_mbps,
    min_video_bitrate_mbps,
    enforce_stream_quality,
    max_resolution,
    api_access_enabled,
    custom_rtmps_enabled,
    analytics_enabled,
    team_collaboration_enabled,
    price_cents,
    log_retention_days
) VALUES
    -- Free tier
    ('free', 5, 1, 1, 3, 10, 1080, 30, 6.0, 3.0, TRUE, '1080p30', FALSE, FALSE, FALSE, FALSE, 0, 7),
    -- FHD tiers
    ('fhd_start', 20, 1, 3, 10, 50, 1080, 60, 8.0, 4.0, TRUE, '1080p60', FALSE, TRUE, TRUE, FALSE, 999, 30),
    ('fhd_flow', 50, 3, 5, 20, 100, 1080, 60, 8.0, 4.0, TRUE, '1080p60', TRUE, TRUE, TRUE, FALSE, 1999, 60),
    ('fhd_boost', 100, 5, 10, 50, 200, 1080, 60, 8.0, 4.0, TRUE, '1080p60', TRUE, TRUE, TRUE, TRUE, 3999, 90),
    -- UHD tiers
    ('uhd_start', 100, 2, 5, 20, 100, 2160, 60, 51.0, 10.0, TRUE, '4K60', TRUE, TRUE, TRUE, FALSE, 2999, 60),
    ('uhd_flow', 250, 5, 10, 50, 300, 2160, 60, 51.0, 12.0, TRUE, '4K60', TRUE, TRUE, TRUE, TRUE, 4999, 90),
    ('uhd_boost', 500, 10, 20, NULL, 500, 2160, 60, 51.0, 15.0, TRUE, '4K60', TRUE, TRUE, TRUE, TRUE, 7999, 180),
    -- Legacy tiers
    ('pro', 50, 5, 10, 20, 200, 1080, 60, 8.0, 4.0, TRUE, '1080p60', FALSE, TRUE, TRUE, FALSE, 1999, 30),
    ('business', 200, 20, 50, NULL, 1000, 2160, 60, 20.0, 10.0, TRUE, '4K60', TRUE, TRUE, TRUE, TRUE, 4999, 90),
    ('enterprise', NULL, NULL, NULL, NULL, NULL, 2160, 60, 30.0, 15.0, FALSE, '4K+', TRUE, TRUE, TRUE, TRUE, 999900, 365)
ON CONFLICT (tier) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE user_profiles IS 'User profiles with subscription tier and usage tracking';
COMMENT ON TABLE subscription_tier_limits IS 'Limits and features for each subscription tier';
COMMENT ON TABLE assets IS 'Video files with validation metadata';
COMMENT ON TABLE playlists IS 'Ordered lists of video assets';
COMMENT ON TABLE destinations IS 'YouTube channel RTMPS endpoints';
COMMENT ON TABLE streams IS 'Active and historical streaming sessions';
COMMENT ON TABLE stream_events IS 'Stream monitoring events and logs';
COMMENT ON TABLE media_folders IS 'Hierarchical folder structure for organizing media assets';
COMMENT ON TABLE media_collections IS 'Collections of media assets for batch operations';
COMMENT ON TABLE stream_assets IS 'Direct asset references for streams with source_type=assets';
