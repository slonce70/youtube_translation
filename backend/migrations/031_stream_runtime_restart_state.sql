ALTER TABLE streams
ADD COLUMN IF NOT EXISTS runtime_restart_attempts INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_next_restart_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS runtime_last_restart_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS runtime_last_failure_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_streams_runtime_next_restart_at
ON streams(runtime_next_restart_at);
