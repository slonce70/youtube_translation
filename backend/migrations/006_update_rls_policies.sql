-- Migration 006: Update Row Level Security Policies
-- This migration updates RLS policies to work with user_id instead of projects

-- Enable RLS on new tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_log ENABLE ROW LEVEL SECURITY;

-- Drop old project-based policies
DROP POLICY IF EXISTS "Users can view own assets" ON assets;
DROP POLICY IF EXISTS "Users can create assets in own projects" ON assets;
DROP POLICY IF EXISTS "Users can update own assets" ON assets;
DROP POLICY IF EXISTS "Users can delete own assets" ON assets;

DROP POLICY IF EXISTS "Users can view own playlists" ON playlists;
DROP POLICY IF EXISTS "Users can create playlists in own projects" ON playlists;
DROP POLICY IF EXISTS "Users can update own playlists" ON playlists;
DROP POLICY IF EXISTS "Users can delete own playlists" ON playlists;

DROP POLICY IF EXISTS "Users can view own playlist items" ON playlist_items;
DROP POLICY IF EXISTS "Users can manage own playlist items" ON playlist_items;

DROP POLICY IF EXISTS "Users can view own destinations" ON destinations;
DROP POLICY IF EXISTS "Users can create destinations in own projects" ON destinations;
DROP POLICY IF EXISTS "Users can update own destinations" ON destinations;
DROP POLICY IF EXISTS "Users can delete own destinations" ON destinations;

DROP POLICY IF EXISTS "Users can view own streams" ON streams;
DROP POLICY IF EXISTS "Users can create streams in own projects" ON streams;
DROP POLICY IF EXISTS "Users can update own streams" ON streams;
DROP POLICY IF EXISTS "Users can delete own streams" ON streams;

DROP POLICY IF EXISTS "Users can view own stream destinations" ON stream_destinations;
DROP POLICY IF EXISTS "Users can manage own stream destinations" ON stream_destinations;

DROP POLICY IF EXISTS "Users can view own stream events" ON stream_events;
DROP POLICY IF EXISTS "Users can insert stream events for own streams" ON stream_events;

-- ==========================================
-- USER_PROFILES POLICIES
-- ==========================================

-- Users can view their own profile
CREATE POLICY "users_can_view_own_profile" ON user_profiles
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can update their own profile (but not admin flags)
CREATE POLICY "users_can_update_own_profile" ON user_profiles
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id 
        AND is_admin = (SELECT is_admin FROM user_profiles WHERE user_id = auth.uid())
    );

-- Admins can view all profiles
CREATE POLICY "admins_can_view_all_profiles" ON user_profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- Admins can update any profile
CREATE POLICY "admins_can_update_all_profiles" ON user_profiles
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- ==========================================
-- ASSETS POLICIES
-- ==========================================

-- Users can manage their own assets
CREATE POLICY "users_can_manage_own_assets" ON assets
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admins can view all assets
CREATE POLICY "admins_can_view_all_assets" ON assets
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- Admins can delete any asset
CREATE POLICY "admins_can_delete_any_asset" ON assets
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- ==========================================
-- PLAYLISTS POLICIES
-- ==========================================

-- Users can manage their own playlists
CREATE POLICY "users_can_manage_own_playlists" ON playlists
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admins can view all playlists
CREATE POLICY "admins_can_view_all_playlists" ON playlists
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- ==========================================
-- PLAYLIST_ITEMS POLICIES
-- ==========================================

-- Users can manage playlist items for their own playlists
CREATE POLICY "users_can_manage_own_playlist_items" ON playlist_items
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM playlists 
            WHERE playlists.id = playlist_id AND playlists.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM playlists 
            WHERE playlists.id = playlist_id AND playlists.user_id = auth.uid()
        )
    );

-- Admins can view all playlist items
CREATE POLICY "admins_can_view_all_playlist_items" ON playlist_items
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- ==========================================
-- DESTINATIONS POLICIES
-- ==========================================

-- Users can manage their own destinations
CREATE POLICY "users_can_manage_own_destinations" ON destinations
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admins can view all destinations
CREATE POLICY "admins_can_view_all_destinations" ON destinations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- ==========================================
-- STREAMS POLICIES
-- ==========================================

-- Users can manage their own streams
CREATE POLICY "users_can_manage_own_streams" ON streams
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admins can view all streams
CREATE POLICY "admins_can_view_all_streams" ON streams
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- Admins can update any stream (for stopping streams, etc.)
CREATE POLICY "admins_can_update_all_streams" ON streams
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- Admins can delete any stream
CREATE POLICY "admins_can_delete_all_streams" ON streams
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- ==========================================
-- STREAM_DESTINATIONS POLICIES
-- ==========================================

-- Users can manage stream_destinations for their own streams
CREATE POLICY "users_can_manage_own_stream_destinations" ON stream_destinations
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM streams 
            WHERE streams.id = stream_id AND streams.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM streams 
            WHERE streams.id = stream_id AND streams.user_id = auth.uid()
        )
    );

-- Admins can view all stream_destinations
CREATE POLICY "admins_can_view_all_stream_destinations" ON stream_destinations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- ==========================================
-- STREAM_EVENTS POLICIES
-- ==========================================

-- Users can view events for their own streams
CREATE POLICY "users_can_view_own_stream_events" ON stream_events
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM streams 
            WHERE streams.id = stream_id AND streams.user_id = auth.uid()
        )
    );

-- System can insert stream events (backend service)
-- Note: This allows any authenticated user to insert events
-- In production, you might want to use a service role instead
CREATE POLICY "system_can_insert_stream_events" ON stream_events
    FOR INSERT
    WITH CHECK (TRUE);

-- Admins can view all stream events
CREATE POLICY "admins_can_view_all_stream_events" ON stream_events
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- ==========================================
-- ADMIN_ACTIONS POLICIES
-- ==========================================

-- Admins can insert their own actions
CREATE POLICY "admins_can_insert_actions" ON admin_actions
    FOR INSERT
    WITH CHECK (
        auth.uid() = admin_user_id
        AND EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- Admins can view all admin actions
CREATE POLICY "admins_can_view_all_actions" ON admin_actions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- Users can view actions that targeted them
CREATE POLICY "users_can_view_actions_targeting_them" ON admin_actions
    FOR SELECT
    USING (auth.uid() = target_user_id);

-- ==========================================
-- SYSTEM_ALERTS POLICIES
-- ==========================================

-- Users can view their own alerts
CREATE POLICY "users_can_view_own_alerts" ON system_alerts
    FOR SELECT
    USING (auth.uid() = user_id);

-- Admins can view all alerts
CREATE POLICY "admins_can_view_all_alerts" ON system_alerts
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- Admins can update alerts (to resolve them)
CREATE POLICY "admins_can_update_alerts" ON system_alerts
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- System can insert alerts
CREATE POLICY "system_can_insert_alerts" ON system_alerts
    FOR INSERT
    WITH CHECK (TRUE);

-- ==========================================
-- USER_ACTIVITY_LOG POLICIES
-- ==========================================

-- Users can view their own activity
CREATE POLICY "users_can_view_own_activity" ON user_activity_log
    FOR SELECT
    USING (auth.uid() = user_id);

-- System can insert activity logs
CREATE POLICY "system_can_insert_activity" ON user_activity_log
    FOR INSERT
    WITH CHECK (TRUE);

-- Admins can view all activity
CREATE POLICY "admins_can_view_all_activity" ON user_activity_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_id = auth.uid() AND is_admin = TRUE
        )
    );

-- ==========================================
-- PROJECTS TABLE (temporary policies until we remove it)
-- ==========================================

-- Keep existing project policies for now (will be removed in Phase 5)
-- These ensure the system doesn't break during migration

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- Comments
COMMENT ON POLICY "users_can_manage_own_assets" ON assets IS 'Users can only access their own assets';
COMMENT ON POLICY "admins_can_view_all_assets" ON assets IS 'Admins can view all assets for monitoring';
COMMENT ON POLICY "users_can_manage_own_streams" ON streams IS 'Users can only access their own streams';
COMMENT ON POLICY "admins_can_update_all_streams" ON streams IS 'Admins can stop any stream';
