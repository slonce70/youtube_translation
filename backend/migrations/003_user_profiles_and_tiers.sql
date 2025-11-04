-- Migration 003: User Profiles and Subscription Tiers
-- This migration adds user profiles with subscription tier support

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    company_name TEXT,
    
    -- Subscription info
    subscription_tier TEXT NOT NULL DEFAULT 'free' 
        CHECK (subscription_tier IN ('free', 'pro', 'business', 'enterprise')),
    subscription_status TEXT NOT NULL DEFAULT 'active'
        CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'suspended')),
    subscription_started_at TIMESTAMPTZ DEFAULT NOW(),
    subscription_expires_at TIMESTAMPTZ,
    
    -- Payment integration (Stripe)
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    
    -- Usage tracking
    current_storage_bytes BIGINT DEFAULT 0,
    total_stream_hours FLOAT DEFAULT 0,
    
    -- Admin flags
    is_admin BOOLEAN DEFAULT FALSE,
    is_suspended BOOLEAN DEFAULT FALSE,
    suspension_reason TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Indexes for user_profiles
CREATE INDEX idx_user_profiles_tier ON user_profiles(subscription_tier);
CREATE INDEX idx_user_profiles_status ON user_profiles(subscription_status);
CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_admin ON user_profiles(is_admin) WHERE is_admin = TRUE;
CREATE INDEX idx_user_profiles_suspended ON user_profiles(is_suspended) WHERE is_suspended = TRUE;
CREATE INDEX idx_user_profiles_stripe_customer ON user_profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Subscription tier limits table
CREATE TABLE IF NOT EXISTS subscription_tier_limits (
    tier TEXT PRIMARY KEY CHECK (tier IN ('free', 'pro', 'business', 'enterprise')),
    
    -- Storage limits
    storage_gb INTEGER,  -- NULL = unlimited
    
    -- Streaming limits
    max_concurrent_streams INTEGER,  -- NULL = unlimited
    max_destinations INTEGER,  -- NULL = unlimited
    max_playlists INTEGER,  -- NULL = unlimited
    max_assets INTEGER,  -- NULL = unlimited
    
    -- Feature flags
    max_resolution TEXT NOT NULL DEFAULT '1080p',
    api_access_enabled BOOLEAN DEFAULT FALSE,
    custom_rtmps_enabled BOOLEAN DEFAULT FALSE,
    analytics_enabled BOOLEAN DEFAULT FALSE,
    team_collaboration_enabled BOOLEAN DEFAULT FALSE,
    
    -- Retention
    log_retention_days INTEGER DEFAULT 7,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default tier limits
INSERT INTO subscription_tier_limits (
    tier, 
    storage_gb, 
    max_concurrent_streams, 
    max_destinations, 
    max_playlists, 
    max_assets, 
    max_resolution,
    api_access_enabled,
    custom_rtmps_enabled,
    analytics_enabled,
    team_collaboration_enabled,
    log_retention_days
) VALUES
    -- Free tier
    ('free', 5, 1, 2, 3, 20, '1080p', FALSE, FALSE, FALSE, FALSE, 7),
    -- Pro tier
    ('pro', 50, 5, 10, 20, 200, '1080p', FALSE, TRUE, TRUE, FALSE, 30),
    -- Business tier
    ('business', 200, 20, 50, NULL, 1000, '4K', TRUE, TRUE, TRUE, TRUE, 90),
    -- Enterprise tier (unlimited)
    ('enterprise', NULL, NULL, NULL, NULL, NULL, '4K+', TRUE, TRUE, TRUE, TRUE, 365)
ON CONFLICT (tier) DO UPDATE SET
    storage_gb = EXCLUDED.storage_gb,
    max_concurrent_streams = EXCLUDED.max_concurrent_streams,
    max_destinations = EXCLUDED.max_destinations,
    max_playlists = EXCLUDED.max_playlists,
    max_assets = EXCLUDED.max_assets,
    max_resolution = EXCLUDED.max_resolution,
    api_access_enabled = EXCLUDED.api_access_enabled,
    custom_rtmps_enabled = EXCLUDED.custom_rtmps_enabled,
    analytics_enabled = EXCLUDED.analytics_enabled,
    team_collaboration_enabled = EXCLUDED.team_collaboration_enabled,
    log_retention_days = EXCLUDED.log_retention_days,
    updated_at = NOW();

-- Create user profiles for existing users (if any)
INSERT INTO user_profiles (user_id, email, subscription_tier, subscription_status, created_at)
SELECT 
    id,
    email,
    'free',  -- Default to free tier
    'active',
    COALESCE(created_at, NOW())
FROM auth.users
WHERE NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE user_profiles.user_id = auth.users.id
)
ON CONFLICT (user_id) DO NOTHING;

-- Function to auto-create user profile on signup
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (user_id, email, subscription_tier, subscription_status)
    VALUES (NEW.id, NEW.email, 'free', 'active')
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_user_profile();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user_profiles updated_at
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_user_profile_updated_at();

-- Comments for documentation
COMMENT ON TABLE user_profiles IS 'User profiles with subscription tier and usage tracking';
COMMENT ON TABLE subscription_tier_limits IS 'Limits and features for each subscription tier';
COMMENT ON COLUMN user_profiles.subscription_tier IS 'Current subscription tier: free, pro, business, or enterprise';
COMMENT ON COLUMN user_profiles.current_storage_bytes IS 'Current storage usage in bytes (updated by triggers)';
COMMENT ON COLUMN subscription_tier_limits.storage_gb IS 'Storage limit in GB (NULL = unlimited)';
COMMENT ON COLUMN subscription_tier_limits.max_concurrent_streams IS 'Maximum concurrent streams (NULL = unlimited)';
