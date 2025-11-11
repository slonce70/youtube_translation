-- Migration 005: Admin Actions and System Alerts (LOCAL VERSION)
-- This migration adds tables for admin actions logging and system alerts
-- For local PostgreSQL (references user_profiles instead of auth.users)

-- Admin actions table (audit log)
CREATE TABLE IF NOT EXISTS admin_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    target_user_id UUID REFERENCES user_profiles(user_id) ON DELETE SET NULL,
    
    action_type TEXT NOT NULL CHECK (action_type IN (
        'suspend_user',
        'unsuspend_user',
        'change_tier',
        'delete_user',
        'delete_asset',
        'stop_stream',
        'view_logs',
        'modify_limits',
        'force_stop_stream',
        'delete_stream',
        'create_user',
        'update_user_profile',
        'view_user_details'
    )),
    
    details JSONB,
    reason TEXT,
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for admin_actions
CREATE INDEX idx_admin_actions_admin_user ON admin_actions(admin_user_id, created_at DESC);
CREATE INDEX idx_admin_actions_target_user ON admin_actions(target_user_id, created_at DESC) 
    WHERE target_user_id IS NOT NULL;
CREATE INDEX idx_admin_actions_type ON admin_actions(action_type, created_at DESC);
CREATE INDEX idx_admin_actions_created ON admin_actions(created_at DESC);

-- System alerts table
CREATE TABLE IF NOT EXISTS system_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'quota_exceeded',
        'stream_failure',
        'storage_full',
        'payment_failed',
        'suspicious_activity',
        'high_resource_usage',
        'ffmpeg_error',
        'upload_failed',
        'validation_error',
        'rate_limit_exceeded'
    )),
    
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    
    user_id UUID REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    stream_id UUID REFERENCES streams(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    
    message TEXT NOT NULL,
    details JSONB,
    
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES user_profiles(user_id) ON DELETE SET NULL,
    resolution_notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for system_alerts
CREATE INDEX idx_system_alerts_unresolved ON system_alerts(created_at DESC) 
    WHERE resolved = FALSE;
CREATE INDEX idx_system_alerts_user ON system_alerts(user_id, created_at DESC) 
    WHERE user_id IS NOT NULL;
CREATE INDEX idx_system_alerts_type ON system_alerts(alert_type, created_at DESC);
CREATE INDEX idx_system_alerts_severity ON system_alerts(severity, created_at DESC);
CREATE INDEX idx_system_alerts_stream ON system_alerts(stream_id, created_at DESC)
    WHERE stream_id IS NOT NULL;

-- User activity log table (for monitoring suspicious activity)
CREATE TABLE IF NOT EXISTS user_activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    
    activity_type TEXT NOT NULL CHECK (activity_type IN (
        'login',
        'logout',
        'upload_start',
        'upload_complete',
        'stream_start',
        'stream_stop',
        'create_playlist',
        'delete_asset',
        'api_call',
        'quota_check',
        'payment_attempt'
    )),
    
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for user_activity_log
CREATE INDEX idx_user_activity_user ON user_activity_log(user_id, created_at DESC);
CREATE INDEX idx_user_activity_type ON user_activity_log(activity_type, created_at DESC);
CREATE INDEX idx_user_activity_ip ON user_activity_log(ip_address, created_at DESC);
CREATE INDEX idx_user_activity_created ON user_activity_log(created_at DESC);

-- Partitioning for user_activity_log (optional, for performance with large datasets)
-- This will be useful when the table grows large
-- Note: This requires PostgreSQL 10+

-- Function to create alert when quota is exceeded
CREATE OR REPLACE FUNCTION check_quota_exceeded()
RETURNS TRIGGER AS $$
DECLARE
    v_tier_limits RECORD;
    v_current_storage_gb FLOAT;
    v_current_assets INTEGER;
    v_current_streams INTEGER;
BEGIN
    -- Get user's tier limits
    SELECT stl.* INTO v_tier_limits
    FROM user_profiles up
    JOIN subscription_tier_limits stl ON stl.tier = up.subscription_tier
    WHERE up.user_id = NEW.user_id;
    
    -- Check storage quota
    IF v_tier_limits.storage_gb IS NOT NULL THEN
        v_current_storage_gb := NEW.current_storage_bytes / (1024.0 * 1024.0 * 1024.0);
        
        IF v_current_storage_gb > v_tier_limits.storage_gb THEN
            INSERT INTO system_alerts (
                alert_type, severity, user_id, message, details
            ) VALUES (
                'quota_exceeded',
                'warning',
                NEW.user_id,
                'Storage quota exceeded',
                jsonb_build_object(
                    'current_gb', v_current_storage_gb,
                    'limit_gb', v_tier_limits.storage_gb,
                    'tier', NEW.subscription_tier
                )
            );
        END IF;
    END IF;
    
    -- Check assets count
    IF v_tier_limits.max_assets IS NOT NULL THEN
        SELECT COUNT(*) INTO v_current_assets
        FROM assets WHERE user_id = NEW.user_id;
        
        IF v_current_assets > v_tier_limits.max_assets THEN
            INSERT INTO system_alerts (
                alert_type, severity, user_id, message, details
            ) VALUES (
                'quota_exceeded',
                'warning',
                NEW.user_id,
                'Asset count limit exceeded',
                jsonb_build_object(
                    'current_assets', v_current_assets,
                    'limit_assets', v_tier_limits.max_assets,
                    'tier', NEW.subscription_tier
                )
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to check quota on user_profiles update
DROP TRIGGER IF EXISTS trigger_check_quota_exceeded ON user_profiles;
CREATE TRIGGER trigger_check_quota_exceeded
    AFTER UPDATE OF current_storage_bytes ON user_profiles
    FOR EACH ROW
    WHEN (NEW.current_storage_bytes <> OLD.current_storage_bytes)
    EXECUTE FUNCTION check_quota_exceeded();

-- Function to create alert when stream fails
CREATE OR REPLACE FUNCTION alert_on_stream_error()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'error' AND (OLD.status IS NULL OR OLD.status <> 'error') THEN
        INSERT INTO system_alerts (
            alert_type, severity, user_id, stream_id, message, details
        ) VALUES (
            'stream_failure',
            'critical',
            NEW.user_id,
            NEW.id,
            COALESCE(NEW.error_message, 'Stream failed with unknown error'),
            jsonb_build_object(
                'stream_name', NEW.name,
                'stream_id', NEW.id,
                'error_message', NEW.error_message,
                'pid', NEW.pid
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for stream errors
DROP TRIGGER IF EXISTS trigger_alert_on_stream_error ON streams;
CREATE TRIGGER trigger_alert_on_stream_error
    AFTER UPDATE OF status ON streams
    FOR EACH ROW
    EXECUTE FUNCTION alert_on_stream_error();

-- Function to log user activity
CREATE OR REPLACE FUNCTION log_user_activity(
    p_user_id UUID,
    p_activity_type TEXT,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_details JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO user_activity_log (
        user_id, activity_type, ip_address, user_agent, details
    ) VALUES (
        p_user_id, p_activity_type, p_ip_address, p_user_agent, p_details
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- Function to resolve alert
CREATE OR REPLACE FUNCTION resolve_alert(
    p_alert_id UUID,
    p_resolved_by UUID,
    p_resolution_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE system_alerts
    SET 
        resolved = TRUE,
        resolved_at = NOW(),
        resolved_by = p_resolved_by,
        resolution_notes = p_resolution_notes
    WHERE id = p_alert_id AND resolved = FALSE;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- View for unresolved critical alerts (useful for admin dashboard)
CREATE OR REPLACE VIEW unresolved_critical_alerts AS
SELECT 
    sa.*,
    up.email as user_email,
    up.subscription_tier,
    s.name as stream_name
FROM system_alerts sa
LEFT JOIN user_profiles up ON up.user_id = sa.user_id
LEFT JOIN streams s ON s.id = sa.stream_id
WHERE sa.resolved = FALSE AND sa.severity = 'critical'
ORDER BY sa.created_at DESC;

-- View for recent admin actions (useful for audit)
CREATE OR REPLACE VIEW recent_admin_actions AS
SELECT 
    aa.*,
    admin.email as admin_email,
    target.email as target_email
FROM admin_actions aa
LEFT JOIN user_profiles admin ON admin.user_id = aa.admin_user_id
LEFT JOIN user_profiles target ON target.user_id = aa.target_user_id
ORDER BY aa.created_at DESC
LIMIT 100;

-- Comments
COMMENT ON TABLE admin_actions IS 'Audit log of all admin actions';
COMMENT ON TABLE system_alerts IS 'System alerts for quota exceeded, stream failures, etc.';
COMMENT ON TABLE user_activity_log IS 'User activity log for monitoring and analytics';
COMMENT ON FUNCTION log_user_activity IS 'Helper function to log user activity';
COMMENT ON FUNCTION resolve_alert IS 'Helper function to resolve system alert';
COMMENT ON VIEW unresolved_critical_alerts IS 'All unresolved critical alerts with user context';
COMMENT ON VIEW recent_admin_actions IS 'Recent 100 admin actions with email context';
