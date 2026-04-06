-- Migration 035: YouTube OAuth connections and provider-aware destination linkage

CREATE TABLE IF NOT EXISTS youtube_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    youtube_channel_id TEXT NOT NULL,
    youtube_channel_title TEXT,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    last_sync_at TIMESTAMPTZ,
    last_sync_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_youtube_connections_user_channel
    ON youtube_connections(user_id, youtube_channel_id);

ALTER TABLE destinations
    ADD COLUMN IF NOT EXISTS provider_kind TEXT,
    ADD COLUMN IF NOT EXISTS provider_connection_id UUID,
    ADD COLUMN IF NOT EXISTS provider_channel_id TEXT;

CREATE INDEX IF NOT EXISTS idx_destinations_provider_connection_id
    ON destinations(provider_connection_id);

CREATE INDEX IF NOT EXISTS idx_destinations_provider_channel_id
    ON destinations(provider_channel_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'destinations'
          AND constraint_name = 'destinations_provider_connection_id_fkey'
    ) THEN
        ALTER TABLE destinations
            ADD CONSTRAINT destinations_provider_connection_id_fkey
            FOREIGN KEY (provider_connection_id)
            REFERENCES youtube_connections(id)
            ON DELETE SET NULL;
    END IF;
END $$;

ALTER TABLE destinations
    DROP CONSTRAINT IF EXISTS check_destination_provider_kind;

ALTER TABLE destinations
    ADD CONSTRAINT check_destination_provider_kind
    CHECK (provider_kind IS NULL OR provider_kind IN ('youtube'));
