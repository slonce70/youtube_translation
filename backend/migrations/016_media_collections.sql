-- Migration 016: Media collections and collection items

CREATE TABLE IF NOT EXISTS media_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    collection_type TEXT NOT NULL,
    description TEXT,
    origin_playlist_id UUID UNIQUE REFERENCES playlists(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill missing columns/constraints when media_collections pre-exists (e.g. created by 000_local_initial_schema.sql)
ALTER TABLE media_collections
    ADD COLUMN IF NOT EXISTS collection_type TEXT NOT NULL DEFAULT 'video_background',
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS origin_playlist_id UUID,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_collections_origin_playlist_id
    ON media_collections(origin_playlist_id)
    WHERE origin_playlist_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'media_collections'
          AND constraint_name = 'fk_media_collections_origin_playlist_id'
    ) THEN
        ALTER TABLE media_collections
            ADD CONSTRAINT fk_media_collections_origin_playlist_id
            FOREIGN KEY (origin_playlist_id) REFERENCES playlists(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Supported collection types
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'media_collections'
          AND constraint_name = 'check_media_collection_type'
    ) THEN
        ALTER TABLE media_collections
            ADD CONSTRAINT check_media_collection_type
            CHECK (collection_type IN ('video_background', 'audio_playlist'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_collections_user_id ON media_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_media_collections_type ON media_collections(collection_type);

-- Auto-update updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE event_object_table = 'media_collections'
          AND trigger_name = 'update_media_collections_updated_at'
    ) THEN
        CREATE TRIGGER update_media_collections_updated_at
            BEFORE UPDATE ON media_collections
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMENT ON TABLE media_collections IS 'Reusable ordered sets of assets for video backgrounds and audio playlists.';

-- Collection items mirror playlist items but allow separate ordering and loop control
CREATE TABLE IF NOT EXISTS collection_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID NOT NULL REFERENCES media_collections(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0,
    loop_mode TEXT NOT NULL DEFAULT 'loop',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill missing columns when collection_items pre-exists (e.g. created by 000_local_initial_schema.sql)
ALTER TABLE collection_items
    ADD COLUMN IF NOT EXISTS loop_mode TEXT NOT NULL DEFAULT 'loop',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'collection_items'
          AND constraint_name = 'check_collection_items_loop_mode'
    ) THEN
        ALTER TABLE collection_items
            ADD CONSTRAINT check_collection_items_loop_mode
            CHECK (loop_mode IN ('loop', 'once', 'shuffle'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_position
    ON collection_items(collection_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_asset
    ON collection_items(collection_id, asset_id);

CREATE INDEX IF NOT EXISTS idx_collection_items_asset_id ON collection_items(asset_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE event_object_table = 'collection_items'
          AND trigger_name = 'update_collection_items_updated_at'
    ) THEN
        CREATE TRIGGER update_collection_items_updated_at
            BEFORE UPDATE ON collection_items
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMENT ON TABLE collection_items IS 'Ordered membership of assets inside media collections.';
