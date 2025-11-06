-- Migration 013: Update subscription tiers to tariff matrix

-- Allow updating subscription tiers without constraint conflicts
ALTER TABLE user_profiles
    DROP CONSTRAINT IF EXISTS user_profiles_subscription_tier_check;

ALTER TABLE subscription_tier_limits
    DROP CONSTRAINT IF EXISTS subscription_tier_limits_tier_check;

-- Extend subscription tier limits with new attributes
ALTER TABLE subscription_tier_limits
    ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS daily_streaming_limit_hours INTEGER,
    ADD COLUMN IF NOT EXISTS calendar_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS branding_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS priority_support_level TEXT,
    ADD COLUMN IF NOT EXISTS dedicated_manager BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS allowed_video_codecs TEXT[];

-- Insert or update the new tariff matrix
INSERT INTO subscription_tier_limits (
    tier,
    price_cents,
    storage_gb,
    max_concurrent_streams,
    max_destinations,
    max_playlists,
    max_assets,
    max_resolution,
    max_resolution_height,
    max_fps,
    min_video_bitrate_mbps,
    max_video_bitrate_mbps,
    daily_streaming_limit_hours,
    calendar_enabled,
    branding_enabled,
    automation_enabled,
    priority_support_level,
    dedicated_manager,
    custom_rtmps_enabled,
    analytics_enabled,
    team_collaboration_enabled,
    log_retention_days,
    enforce_stream_quality,
    allowed_video_codecs
) VALUES
    ('free', 0, 3, 1, 1, 5, 20, '1080p', 1080, 30, 3, 10, 8, FALSE, FALSE, FALSE, 'community', FALSE, FALSE, FALSE, FALSE, 7, TRUE, ARRAY['h264']),
    ('fhd_start', 1000, 50, 1, 3, 15, 100, '1080p', 1080, 30, 3, 12, 24, FALSE, FALSE, FALSE, 'standard_email', FALSE, TRUE, TRUE, FALSE, 30, TRUE, ARRAY['h264']),
    ('fhd_flow', 2000, 100, 2, 6, 25, 200, '1080p', 1080, 60, 3, 12, NULL, TRUE, TRUE, FALSE, 'priority_email', FALSE, TRUE, TRUE, FALSE, 45, TRUE, ARRAY['h264']),
    ('fhd_boost', 3500, 200, 4, 10, 40, 400, '1080p', 1080, 60, 3, 15, NULL, TRUE, TRUE, TRUE, 'priority_email', FALSE, TRUE, TRUE, TRUE, 60, TRUE, ARRAY['h264']),
    ('uhd_start', 6900, 200, 1, 4, 25, 400, '2160p', 2160, 60, 6, 30, NULL, TRUE, TRUE, FALSE, 'priority_email_24h', FALSE, TRUE, TRUE, TRUE, 60, TRUE, ARRAY['h264', 'hevc']),
    ('uhd_flow', 10900, 400, 2, 8, 50, 800, '2160p', 2160, 60, 6, 35, NULL, TRUE, TRUE, TRUE, 'same_day_email', FALSE, TRUE, TRUE, TRUE, 90, TRUE, ARRAY['h264', 'hevc']),
    ('uhd_boost', 15900, 800, 4, 12, 80, 1200, '2160p', 2160, 60, 6, 40, NULL, TRUE, TRUE, TRUE, 'same_day_email', TRUE, TRUE, TRUE, TRUE, 120, TRUE, ARRAY['h264', 'hevc'])
ON CONFLICT (tier) DO UPDATE SET
    price_cents = EXCLUDED.price_cents,
    storage_gb = EXCLUDED.storage_gb,
    max_concurrent_streams = EXCLUDED.max_concurrent_streams,
    max_destinations = EXCLUDED.max_destinations,
    max_playlists = EXCLUDED.max_playlists,
    max_assets = EXCLUDED.max_assets,
    max_resolution = EXCLUDED.max_resolution,
    max_resolution_height = EXCLUDED.max_resolution_height,
    max_fps = EXCLUDED.max_fps,
    min_video_bitrate_mbps = EXCLUDED.min_video_bitrate_mbps,
    max_video_bitrate_mbps = EXCLUDED.max_video_bitrate_mbps,
    daily_streaming_limit_hours = EXCLUDED.daily_streaming_limit_hours,
    calendar_enabled = EXCLUDED.calendar_enabled,
    branding_enabled = EXCLUDED.branding_enabled,
    automation_enabled = EXCLUDED.automation_enabled,
    priority_support_level = EXCLUDED.priority_support_level,
    dedicated_manager = EXCLUDED.dedicated_manager,
    custom_rtmps_enabled = EXCLUDED.custom_rtmps_enabled,
    analytics_enabled = EXCLUDED.analytics_enabled,
    team_collaboration_enabled = EXCLUDED.team_collaboration_enabled,
    log_retention_days = EXCLUDED.log_retention_days,
    enforce_stream_quality = EXCLUDED.enforce_stream_quality,
    allowed_video_codecs = EXCLUDED.allowed_video_codecs,
    updated_at = NOW();

-- Migrate legacy tiers to the new plan keys
UPDATE user_profiles
SET subscription_tier = 'fhd_boost'
WHERE subscription_tier = 'pro';

UPDATE user_profiles
SET subscription_tier = 'uhd_flow'
WHERE subscription_tier = 'business';

UPDATE user_profiles
SET subscription_tier = 'uhd_boost'
WHERE subscription_tier = 'enterprise';

-- Ensure subscription start date populated after migration for moved users
UPDATE user_profiles
SET subscription_started_at = COALESCE(subscription_started_at, NOW()),
    subscription_expires_at = NULL
WHERE subscription_tier IN ('fhd_boost', 'uhd_flow', 'uhd_boost');

-- Remove legacy tier rows
DELETE FROM subscription_tier_limits
WHERE tier IN ('pro', 'business', 'enterprise');

-- Recreate tier constraints with the new set of plan keys
ALTER TABLE user_profiles
    ADD CONSTRAINT user_profiles_subscription_tier_check
    CHECK (subscription_tier IN ('free', 'fhd_start', 'fhd_flow', 'fhd_boost', 'uhd_start', 'uhd_flow', 'uhd_boost'));

ALTER TABLE subscription_tier_limits
    ADD CONSTRAINT subscription_tier_limits_tier_check
    CHECK (tier IN ('free', 'fhd_start', 'fhd_flow', 'fhd_boost', 'uhd_start', 'uhd_flow', 'uhd_boost'));

-- Set price default back to zero for free plan while keeping explicit values for others
ALTER TABLE subscription_tier_limits
    ALTER COLUMN price_cents SET DEFAULT 0;

COMMENT ON COLUMN subscription_tier_limits.price_cents IS 'Monthly price in cents';
COMMENT ON COLUMN subscription_tier_limits.daily_streaming_limit_hours IS 'Daily streaming limit in hours (NULL = unlimited)';
COMMENT ON COLUMN subscription_tier_limits.allowed_video_codecs IS 'Array of allowed video codecs for passthrough streams';
