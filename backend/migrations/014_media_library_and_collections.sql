-- Migration 014: Media library folders, tags, and collections support
-- Adds asset metadata columns, folder/tag linking tables, media collections,
-- and extends streams with collection-aware configuration fields.

BEGIN;

-- ==================================================
-- Assets enhancements
-- ==================================================

ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS asset_type TEXT DEFAULT 'video';

UPDATE assets
SET asset_type = 'video'
WHERE asset_type IS NULL;

ALTER TABLE assets
    ALTER COLUMN asset_type SET NOT NULL;

ALTER TABLE assets
    DROP CONSTRAINT IF EXISTS check_asset_type;

ALTER TABLE assets
    ADD CONSTRAINT check_asset_type
    CHECK (asset_type IN ('video', 'audio'));

ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS codec_info JSONB;

CREATE INDEX IF NOT EXISTS idx_assets_user_asset_type
    ON assets(user_id, asset_type);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'assets'::regclass
          AND conname = 'uq_assets_storage_path'
    ) THEN
        ALTER TABLE assets
            ADD CONSTRAINT uq_assets_storage_path UNIQUE (storage_path);
    END IF;
END $$;

-- ==================================================
-- Media folders and tags
-- ==================================================

CREATE TABLE IF NOT EXISTS media_folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    parent_id UUID REFERENCES media_folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_tag BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_folders_user_id ON media_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_media_folders_parent_id ON media_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_media_folders_is_tag ON media_folders(is_tag);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'media_folders'::regclass
          AND conname = 'uq_media_folders_name'
    ) THEN
        ALTER TABLE media_folders
            ADD CONSTRAINT uq_media_folders_name
            UNIQUE (user_id, parent_id, name);
    END IF;
END $$;

-- ==================================================
-- Asset-folder links
-- ==================================================

CREATE TABLE IF NOT EXISTS asset_folder_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    folder_id UUID NOT NULL REFERENCES media_folders(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL DEFAULT 'folder',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_folder_links_asset_id
    ON asset_folder_links(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_folder_links_folder_id
    ON asset_folder_links(folder_id);
CREATE INDEX IF NOT EXISTS idx_asset_folder_links_link_type
    ON asset_folder_links(link_type);

ALTER TABLE asset_folder_links
    DROP CONSTRAINT IF EXISTS check_asset_folder_link_type;

ALTER TABLE asset_folder_links
    ADD CONSTRAINT check_asset_folder_link_type
    CHECK (link_type IN ('folder', 'tag'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'asset_folder_links'::regclass
          AND conname = 'uq_asset_folder_link'
    ) THEN
        ALTER TABLE asset_folder_links
            ADD CONSTRAINT uq_asset_folder_link
            UNIQUE (asset_id, folder_id, link_type);
    END IF;
END $$;

-- ==================================================
-- Media collections
-- ==================================================

CREATE TABLE IF NOT EXISTS media_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    collection_type TEXT NOT NULL,
    loop_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    shuffle_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_collections_user_id ON media_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_media_collections_type ON media_collections(collection_type);

ALTER TABLE media_collections
    DROP CONSTRAINT IF EXISTS check_collection_type;

ALTER TABLE media_collections
    ADD CONSTRAINT check_collection_type
    CHECK (collection_type IN ('video_background', 'audio_playlist'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'media_collections'::regclass
          AND conname = 'uq_media_collection_name'
    ) THEN
        ALTER TABLE media_collections
            ADD CONSTRAINT uq_media_collection_name
            UNIQUE (user_id, name, collection_type);
    END IF;
END $$;

-- ==================================================
-- Collection items
-- ==================================================

CREATE TABLE IF NOT EXISTS collection_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID NOT NULL REFERENCES media_collections(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    loop_mode TEXT NOT NULL DEFAULT 'inherit',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection_id
    ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_asset_id
    ON collection_items(asset_id);

ALTER TABLE collection_items
    DROP CONSTRAINT IF EXISTS check_collection_item_position;

ALTER TABLE collection_items
    ADD CONSTRAINT check_collection_item_position
    CHECK (position >= 0);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'collection_items'::regclass
          AND conname = 'uq_collection_item_position'
    ) THEN
        ALTER TABLE collection_items
            ADD CONSTRAINT uq_collection_item_position
            UNIQUE (collection_id, position);
    END IF;
END $$;

-- ==================================================
-- Streams enhancements for collections
-- ==================================================

ALTER TABLE streams
    ADD COLUMN IF NOT EXISTS video_collection_id UUID;

ALTER TABLE streams
    ADD COLUMN IF NOT EXISTS audio_collection_id UUID;

ALTER TABLE streams
    ADD COLUMN IF NOT EXISTS mix_mode TEXT;

ALTER TABLE streams
    ADD COLUMN IF NOT EXISTS settings_json JSONB;

UPDATE streams
SET mix_mode = 'video_only'
WHERE mix_mode IS NULL;

ALTER TABLE streams
    ALTER COLUMN mix_mode SET DEFAULT 'video_only';

ALTER TABLE streams
    ALTER COLUMN mix_mode SET NOT NULL;

ALTER TABLE streams
    DROP CONSTRAINT IF EXISTS check_mix_mode;

ALTER TABLE streams
    ADD CONSTRAINT check_mix_mode
    CHECK (mix_mode IN ('video_only', 'audio_only', 'mixed'));

ALTER TABLE streams
    DROP CONSTRAINT IF EXISTS check_source_type;

ALTER TABLE streams
    ADD CONSTRAINT check_source_type
    CHECK (source_type IN ('playlist', 'assets', 'collection'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'streams'::regclass
          AND conname = 'fk_streams_video_collection_id'
    ) THEN
        ALTER TABLE streams
            ADD CONSTRAINT fk_streams_video_collection_id
            FOREIGN KEY (video_collection_id)
            REFERENCES media_collections(id)
            ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'streams'::regclass
          AND conname = 'fk_streams_audio_collection_id'
    ) THEN
        ALTER TABLE streams
            ADD CONSTRAINT fk_streams_audio_collection_id
            FOREIGN KEY (audio_collection_id)
            REFERENCES media_collections(id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_streams_video_collection_id
    ON streams(video_collection_id);
CREATE INDEX IF NOT EXISTS idx_streams_audio_collection_id
    ON streams(audio_collection_id);

COMMIT;
