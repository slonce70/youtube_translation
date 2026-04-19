ALTER TABLE streams
    DROP COLUMN IF EXISTS runtime_owner_id,
    DROP COLUMN IF EXISTS runtime_lease_expires_at,
    DROP COLUMN IF EXISTS runtime_restart_attempts,
    DROP COLUMN IF EXISTS runtime_next_restart_at,
    DROP COLUMN IF EXISTS runtime_last_restart_at,
    DROP COLUMN IF EXISTS runtime_last_failure_at;

DROP INDEX IF EXISTS idx_streams_runtime_owner_id;
DROP INDEX IF EXISTS idx_streams_runtime_lease_expires_at;
DROP INDEX IF EXISTS idx_streams_runtime_next_restart_at;
