-- Migration 010: Stream quality limits per subscription tier

ALTER TABLE subscription_tier_limits
    ADD COLUMN IF NOT EXISTS max_resolution_height INTEGER,
    ADD COLUMN IF NOT EXISTS max_fps INTEGER,
    ADD COLUMN IF NOT EXISTS max_video_bitrate_mbps INTEGER,
    ADD COLUMN IF NOT EXISTS min_video_bitrate_mbps INTEGER,
    ADD COLUMN IF NOT EXISTS enforce_stream_quality BOOLEAN DEFAULT TRUE;

-- Set sensible defaults for existing tiers.
UPDATE subscription_tier_limits
SET
    max_resolution_height = 1080,
    max_fps = 30,
    min_video_bitrate_mbps = 3,
    max_video_bitrate_mbps = 10
WHERE tier = 'free';

UPDATE subscription_tier_limits
SET
    max_resolution_height = 2160,
    max_fps = 60,
    max_video_bitrate_mbps = 45
WHERE tier IN ('pro', 'business', 'enterprise');

-- Ensure NULL means "no limit" for bitrate/FPS/resolution if needed.
UPDATE subscription_tier_limits
SET
    enforce_stream_quality = FALSE
WHERE tier IN ('enterprise');
