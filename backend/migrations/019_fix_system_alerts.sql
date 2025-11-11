-- Migration 019: Align system alert constraints with new backend logic

-- Relax/align alert_type values
ALTER TABLE system_alerts
    DROP CONSTRAINT IF EXISTS system_alerts_alert_type_check;

ALTER TABLE system_alerts
    ADD CONSTRAINT system_alerts_alert_type_check CHECK (alert_type IN (
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
    ));

-- Align severity levels (remove legacy 'error')
ALTER TABLE system_alerts
    DROP CONSTRAINT IF EXISTS system_alerts_severity_check;

ALTER TABLE system_alerts
    ADD CONSTRAINT system_alerts_severity_check CHECK (severity IN ('info', 'warning', 'critical'));

-- Ensure local installations reference user_profiles instead of auth.users
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'system_alerts_user_id_fkey'
          AND table_name = 'system_alerts'
    ) THEN
        ALTER TABLE system_alerts
            DROP CONSTRAINT system_alerts_user_id_fkey;
    END IF;
END $$;

ALTER TABLE system_alerts
    ADD CONSTRAINT system_alerts_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE;

-- Same for user_activity_log
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'user_activity_log_user_id_fkey'
          AND table_name = 'user_activity_log'
    ) THEN
        ALTER TABLE user_activity_log
            DROP CONSTRAINT user_activity_log_user_id_fkey;
    END IF;
END $$;

ALTER TABLE user_activity_log
    ADD CONSTRAINT user_activity_log_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE;
