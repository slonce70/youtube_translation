-- Migration 009: Align core tables user_id foreign keys with user_profiles
-- Date: 2025-11-04

BEGIN;

ALTER TABLE assets
    DROP CONSTRAINT IF EXISTS fk_assets_user_id,
    ADD CONSTRAINT fk_assets_user_id
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE;

ALTER TABLE playlists
    DROP CONSTRAINT IF EXISTS fk_playlists_user_id,
    ADD CONSTRAINT fk_playlists_user_id
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE;

ALTER TABLE destinations
    DROP CONSTRAINT IF EXISTS fk_destinations_user_id,
    ADD CONSTRAINT fk_destinations_user_id
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE;

ALTER TABLE streams
    DROP CONSTRAINT IF EXISTS fk_streams_user_id,
    ADD CONSTRAINT fk_streams_user_id
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE;

COMMIT;
