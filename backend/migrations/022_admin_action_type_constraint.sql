-- Migration 022: Align admin_actions.action_type check constraint with current enum
-- Drops legacy constraint (from initial schema) and recreates it with the expanded set

ALTER TABLE IF EXISTS admin_actions
    DROP CONSTRAINT IF EXISTS admin_actions_action_type_check;

ALTER TABLE IF EXISTS admin_actions
    ADD CONSTRAINT admin_actions_action_type_check
    CHECK (
        action_type IN (
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
            'view_user_details',
            'resolve_alert'
        )
    );
