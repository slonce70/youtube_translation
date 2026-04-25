-- Migration 037: Persist FFmpeg restart attempts on the streams row.
-- Created: 2026-04-25 (Sprint 2 — H5 remediation).
--
-- Migration 031 originally added these columns; 036 dropped them while the
-- restart-state machine was relocated to in-memory tracking in
-- ``ffmpeg_manager.py``. The audit (2026-04-25) flagged that this leaves the
-- restart counter vulnerable to a backend crash: the in-memory counter
-- resets to zero, and a flapping ffmpeg child can restart in a tight loop
-- forever even though it has already exceeded the configured ceiling.
--
-- We re-introduce two narrow columns and one supporting index:
--
-- * ``runtime_restart_attempts`` — monotonic counter of consecutive failed
--   ffmpeg starts since the last clean exit. Reset to 0 on a manual stop,
--   on a successful long-running window (>=N seconds — enforced by
--   ffmpeg_manager), or on a fresh start.
-- * ``runtime_last_failure_at`` — wall-clock timestamp of the last failure;
--   used for backoff and observability.

ALTER TABLE streams
    ADD COLUMN IF NOT EXISTS runtime_restart_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS runtime_last_failure_at TIMESTAMPTZ;

COMMENT ON COLUMN streams.runtime_restart_attempts IS
    'Persistent FFmpeg restart counter. Survives backend restarts so a flapping stream cannot bypass ffmpeg_auto_restart_attempts ceiling by counting on in-memory amnesia.';
COMMENT ON COLUMN streams.runtime_last_failure_at IS
    'Wall-clock timestamp of the most recent ffmpeg child non-zero exit; used for restart backoff and observability.';
