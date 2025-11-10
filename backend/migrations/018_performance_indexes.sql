-- Migration 018: Add performance indexes for frequently queried columns
-- Created: 2025-11-10
-- Purpose: Improve query performance by adding indexes on frequently filtered columns

-- Index for assets validation status (used in filtering and dashboard queries)
CREATE INDEX IF NOT EXISTS idx_assets_validation_status 
ON assets(validation_status) 
WHERE validation_status IS NOT NULL;

-- Index for streams status (used in filtering active/stopped streams)
CREATE INDEX IF NOT EXISTS idx_streams_status_user 
ON streams(user_id, status);

-- Composite index for stream queries by user and status
CREATE INDEX IF NOT EXISTS idx_streams_user_started 
ON streams(user_id, started_at DESC) 
WHERE started_at IS NOT NULL;

-- Index for user activity log IP addresses (security logging and analysis)
CREATE INDEX IF NOT EXISTS idx_user_activity_ip 
ON user_activity_log(ip_address, created_at DESC) 
WHERE ip_address IS NOT NULL;

-- Index for system alerts filtering by severity and resolved status
CREATE INDEX IF NOT EXISTS idx_system_alerts_severity_resolved 
ON system_alerts(severity, resolved, created_at DESC);

-- Index for admin actions by admin user (audit trail)
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_user_time 
ON admin_actions(admin_user_id, created_at DESC);

-- Index for destinations enabled status (active destination lookups)
CREATE INDEX IF NOT EXISTS idx_destinations_user_enabled 
ON destinations(user_id, enabled) 
WHERE enabled = true;

-- Index for playlist items ordering (used in every playlist retrieval)
CREATE INDEX IF NOT EXISTS idx_playlist_items_position 
ON playlist_items(playlist_id, position);

-- Index for collection items ordering
CREATE INDEX IF NOT EXISTS idx_collection_items_position 
ON collection_items(collection_id, position);

-- Index for stream events by stream and time (log retrieval)
CREATE INDEX IF NOT EXISTS idx_stream_events_stream_time 
ON stream_events(stream_id, created_at DESC);

-- Index for media folders by parent (folder tree navigation)
CREATE INDEX IF NOT EXISTS idx_media_folders_parent 
ON media_folders(parent_id, user_id) 
WHERE parent_id IS NOT NULL;

-- Index for asset folder links (folder contents retrieval)
CREATE INDEX IF NOT EXISTS idx_asset_folder_links_folder 
ON asset_folder_links(folder_id, asset_id);

-- Composite index for assets by type and user
CREATE INDEX IF NOT EXISTS idx_assets_user_type 
ON assets(user_id, asset_type, created_at DESC);

-- Index for media collections by type and active status
CREATE INDEX IF NOT EXISTS idx_collections_user_type_active 
ON media_collections(user_id, collection_type, is_active) 
WHERE is_active = true;

-- Comment explaining the migration
COMMENT ON INDEX idx_assets_validation_status IS 'Performance: Filter assets by validation status';
COMMENT ON INDEX idx_streams_status_user IS 'Performance: Filter streams by user and status';
COMMENT ON INDEX idx_user_activity_ip IS 'Security: Track activity by IP address';
COMMENT ON INDEX idx_system_alerts_severity_resolved IS 'Performance: Filter alerts by severity and resolution';

-- Verify indexes were created
DO $$
DECLARE
    index_count integer;
BEGIN
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%'
    AND indexname IN (
        'idx_assets_validation_status',
        'idx_streams_status_user',
        'idx_streams_user_started',
        'idx_user_activity_ip',
        'idx_system_alerts_severity_resolved',
        'idx_admin_actions_admin_user_time',
        'idx_destinations_user_enabled',
        'idx_playlist_items_position',
        'idx_collection_items_position',
        'idx_stream_events_stream_time',
        'idx_media_folders_parent',
        'idx_asset_folder_links_folder',
        'idx_assets_user_type',
        'idx_collections_user_type_active'
    );
    
    RAISE NOTICE 'Created % performance indexes', index_count;
END $$;
