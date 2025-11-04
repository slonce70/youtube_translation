-- Migration 008: Align admin tables with user_profiles
-- Date: 2025-11-04
-- Description: Replace references to auth.users with user_profiles for offline compatibility

BEGIN;

-- Admin actions foreign keys
ALTER TABLE admin_actions
    DROP CONSTRAINT IF EXISTS admin_actions_admin_user_id_fkey,
    DROP CONSTRAINT IF EXISTS admin_actions_target_user_id_fkey;

ALTER TABLE admin_actions
    ADD CONSTRAINT admin_actions_admin_user_id_fkey
        FOREIGN KEY (admin_user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    ADD CONSTRAINT admin_actions_target_user_id_fkey
        FOREIGN KEY (target_user_id) REFERENCES user_profiles(user_id) ON DELETE SET NULL;

-- System alerts foreign keys
ALTER TABLE system_alerts
    DROP CONSTRAINT IF EXISTS system_alerts_user_id_fkey,
    DROP CONSTRAINT IF EXISTS system_alerts_resolved_by_fkey;

ALTER TABLE system_alerts
    ADD CONSTRAINT system_alerts_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    ADD CONSTRAINT system_alerts_resolved_by_fkey
        FOREIGN KEY (resolved_by) REFERENCES user_profiles(user_id) ON DELETE SET NULL;

-- User activity log foreign key
ALTER TABLE user_activity_log
    DROP CONSTRAINT IF EXISTS user_activity_log_user_id_fkey;

ALTER TABLE user_activity_log
    ADD CONSTRAINT user_activity_log_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE;

COMMIT;
