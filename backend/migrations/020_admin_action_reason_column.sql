-- Migration 020: Ensure admin_actions.reason column exists
-- Older local databases created before migration 005 might miss this column.
-- The backend now depends on it when logging admin actions.

ALTER TABLE IF EXISTS admin_actions
    ADD COLUMN IF NOT EXISTS reason TEXT;

COMMENT ON COLUMN admin_actions.reason IS 'Optional justification provided by the admin';
