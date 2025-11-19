-- Migration 021: Ensure admin_actions has request metadata columns
-- Adds ip_address (INET) and user_agent (TEXT) columns for local/postgres setups

ALTER TABLE IF EXISTS admin_actions
    ADD COLUMN IF NOT EXISTS ip_address INET,
    ADD COLUMN IF NOT EXISTS user_agent TEXT;

COMMENT ON COLUMN admin_actions.ip_address IS 'Optional IPv4/IPv6 address captured for the admin action';
COMMENT ON COLUMN admin_actions.user_agent IS 'Optional user agent string captured for the admin action';
