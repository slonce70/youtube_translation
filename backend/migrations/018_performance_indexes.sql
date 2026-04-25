-- @autocommit
-- Migration 018: Add performance indexes for frequently queried columns
-- Created: 2025-11-10
-- Updated: 2026-04-25 — converted to CREATE INDEX CONCURRENTLY for online builds.
-- Purpose: Improve query performance by adding indexes on frequently filtered columns.
--
-- The "@autocommit" directive at the top tells `apply_migrations.py` to run this
-- file outside of the wrapping transaction. CREATE INDEX CONCURRENTLY cannot run
-- inside a transaction, so each statement here executes in its own implicit
-- transaction. All statements are idempotent (IF NOT EXISTS), so re-running this
-- migration after a partial failure is safe.

-- Index for assets validation status (used in filtering and dashboard queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_validation_status
    ON assets(validation_status)
    WHERE validation_status IS NOT NULL;

-- Index for streams status (used in filtering active/stopped streams)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streams_status_user
    ON streams(user_id, status);

-- Composite index for stream queries by user and started_at desc
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streams_user_started
    ON streams(user_id, started_at DESC)
    WHERE started_at IS NOT NULL;

-- Index for user activity log IP addresses (security logging and analysis)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activity_ip
    ON user_activity_log(ip_address, created_at DESC)
    WHERE ip_address IS NOT NULL;

-- Index for system alerts filtering by severity and resolved status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_system_alerts_severity_resolved
    ON system_alerts(severity, resolved, created_at DESC);

-- Index for admin actions by admin user (audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_actions_admin_user_time
    ON admin_actions(admin_user_id, created_at DESC);

-- Index for destinations enabled status (active destination lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_destinations_user_enabled
    ON destinations(user_id, enabled)
    WHERE enabled = true;

-- Index for playlist items ordering (used in every playlist retrieval)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playlist_items_position
    ON playlist_items(playlist_id, position);

-- Index for collection items ordering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collection_items_position
    ON collection_items(collection_id, position);

-- Index for stream events by stream and time (log retrieval)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stream_events_stream_time
    ON stream_events(stream_id, created_at DESC);

-- Index for media folders by parent (folder tree navigation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_folders_parent
    ON media_folders(parent_id, user_id)
    WHERE parent_id IS NOT NULL;

-- Index for asset folder links (folder contents retrieval)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_folder_links_folder
    ON asset_folder_links(folder_id, asset_id);

-- Composite index for assets by type and user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_user_type
    ON assets(user_id, asset_type, created_at DESC);

-- Index for media collections by type and active status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collections_user_type_active
    ON media_collections(user_id, collection_type, is_active)
    WHERE is_active = true;

-- COMMENT ON INDEX statements run in implicit transactions, which is fine.
COMMENT ON INDEX idx_assets_validation_status IS 'Performance: Filter assets by validation status';
COMMENT ON INDEX idx_streams_status_user IS 'Performance: Filter streams by user and status';
COMMENT ON INDEX idx_user_activity_ip IS 'Security: Track activity by IP address';
COMMENT ON INDEX idx_system_alerts_severity_resolved IS 'Performance: Filter alerts by severity and resolution';
