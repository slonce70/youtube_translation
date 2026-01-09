-- Migration 025: Store user timezone for scheduling/UI

DO $$
BEGIN
    ALTER TABLE user_profiles
        ADD COLUMN IF NOT EXISTS timezone TEXT;
EXCEPTION
    WHEN duplicate_column THEN
        NULL;
END $$;

