-- Migration 034: Align UHD plan bitrate caps with 4K60 guidance

UPDATE subscription_tier_limits
SET
    max_resolution_height = COALESCE(max_resolution_height, 2160),
    max_fps = COALESCE(max_fps, 60),
    max_video_bitrate_mbps = GREATEST(COALESCE(max_video_bitrate_mbps, 51), 51)
WHERE tier IN ('uhd_start', 'uhd_flow', 'uhd_boost');
