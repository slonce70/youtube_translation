-- @autocommit
-- Rollback for migration 018_performance_indexes.sql.
-- Drops every index that 018 creates. Each DROP runs in its own implicit
-- transaction (CONCURRENTLY requires this) and is idempotent.
--
-- Apply with:
--   psql "$DATABASE_URL" -f migrations/018_performance_indexes_rollback.sql
-- (NOT via apply_migrations.py — this file is operator-invoked only.)

DROP INDEX CONCURRENTLY IF EXISTS idx_assets_validation_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_streams_status_user;
DROP INDEX CONCURRENTLY IF EXISTS idx_streams_user_started;
DROP INDEX CONCURRENTLY IF EXISTS idx_user_activity_ip;
DROP INDEX CONCURRENTLY IF EXISTS idx_system_alerts_severity_resolved;
DROP INDEX CONCURRENTLY IF EXISTS idx_admin_actions_admin_user_time;
DROP INDEX CONCURRENTLY IF EXISTS idx_destinations_user_enabled;
DROP INDEX CONCURRENTLY IF EXISTS idx_playlist_items_position;
DROP INDEX CONCURRENTLY IF EXISTS idx_collection_items_position;
DROP INDEX CONCURRENTLY IF EXISTS idx_stream_events_stream_time;
DROP INDEX CONCURRENTLY IF EXISTS idx_media_folders_parent;
DROP INDEX CONCURRENTLY IF EXISTS idx_asset_folder_links_folder;
DROP INDEX CONCURRENTLY IF EXISTS idx_assets_user_type;
DROP INDEX CONCURRENTLY IF EXISTS idx_collections_user_type_active;
