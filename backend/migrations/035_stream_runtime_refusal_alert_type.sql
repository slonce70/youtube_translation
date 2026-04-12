-- Migration 035: allow runtime terminal-state refusal alerts in system_alerts

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
        'rate_limit_exceeded',
        'collection_depleted',
        'stream_runtime_refused_terminal_state'
    ));
