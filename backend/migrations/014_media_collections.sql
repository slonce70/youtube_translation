-- Migration 014: Media library foundations and stream collection support
-- Phase 1 of media library rollout

BEGIN;

-- 1. Extend assets with asset_type and codec_info
ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_type TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS codec_info JSONB;

-- Backfill codec summary for existing assets based on stored metadata
UPDATE assets
SET codec_info = COALESCE(
    codec_info,
    jsonb_strip_nulls(
        jsonb_build_object(
            'video', meta -> 'video',
            'audio', meta -> 'audio'
        )
    )
)
WHERE meta IS NOT NULL;

-- Backfill asset types using metadata and codec hints
UPDATE assets
SET asset_type = CASE
    WHEN meta ? 'type' AND lower(meta->>'type') IN ('video', 'audio') THEN lower(meta->>'type')
    WHEN meta ? 'video' THEN 'video'
    WHEN (meta ? 'audio') AND NOT (meta ? 'video') THEN 'audio'
    WHEN video_codec IS NOT NULL THEN 'video'
    WHEN audio_codec IS NOT NULL AND video_codec IS NULL THEN 'audio'
    ELSE 'video'
END
WHERE asset_type IS NULL OR asset_type NOT IN ('video', 'audio');

ALTER TABLE assets ALTER COLUMN asset_type SET DEFAULT 'video';
UPDATE assets SET asset_type = 'video' WHERE asset_type IS NULL;
ALTER TABLE assets ALTER COLUMN asset_type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'check_asset_type_enum'
        AND conrelid = 'assets'::regclass
    ) THEN
        ALTER TABLE assets
            ADD CONSTRAINT check_asset_type_enum
            CHECK (asset_type IN ('video', 'audio'));
    END IF;
END
$$;

-- 2. Virtual folder support
CREATE TABLE IF NOT EXISTS media_folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_id UUID REFERENCES media_folders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, parent_id, name)
);

CREATE INDEX IF NOT EXISTS idx_media_folders_user ON media_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_media_folders_parent ON media_folders(parent_id);

CREATE TABLE IF NOT EXISTS asset_folder_links (
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    folder_id UUID NOT NULL REFERENCES media_folders(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(asset_id, folder_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_folder_links_folder ON asset_folder_links(folder_id);

-- Create root folder for every known user
WITH distinct_users AS (
    SELECT DISTINCT user_id FROM user_profiles
    UNION
    SELECT DISTINCT user_id FROM assets
    UNION
    SELECT DISTINCT user_id FROM playlists
    UNION
    SELECT DISTINCT user_id FROM streams
)
INSERT INTO media_folders (user_id, name, parent_id)
SELECT user_id, 'root', NULL
FROM distinct_users
WHERE user_id IS NOT NULL
ON CONFLICT (user_id, parent_id, name) DO NOTHING;

-- Link existing assets to their owner's root folder
INSERT INTO asset_folder_links (asset_id, folder_id)
SELECT a.id, mf.id
FROM assets a
JOIN media_folders mf
    ON mf.user_id = a.user_id
   AND mf.parent_id IS NULL
   AND mf.name = 'root'
ON CONFLICT DO NOTHING;

-- 3. Media collections & collection items
CREATE TABLE IF NOT EXISTS media_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    collection_type TEXT NOT NULL CHECK (collection_type IN ('video_background', 'audio_playlist')),
    default_loop BOOLEAN NOT NULL DEFAULT TRUE,
    allow_shuffle BOOLEAN NOT NULL DEFAULT FALSE,
    revision INTEGER NOT NULL DEFAULT 1,
    legacy_playlist_id UUID UNIQUE REFERENCES playlists(id) ON DELETE SET NULL,
    legacy_stream_id UUID UNIQUE REFERENCES streams(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    audit_created_at TIMESTAMPTZ DEFAULT NOW(),
    audit_updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_collections_user ON media_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_media_collections_type ON media_collections(collection_type);

CREATE TABLE IF NOT EXISTS collection_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID NOT NULL REFERENCES media_collections(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INT NOT NULL CHECK (position >= 0),
    loop_mode TEXT NOT NULL DEFAULT 'inherit' CHECK (loop_mode IN ('inherit', 'loop', 'once')),
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    deactivated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(collection_id, position),
    UNIQUE(collection_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id, position);
CREATE INDEX IF NOT EXISTS idx_collection_items_asset ON collection_items(asset_id);

-- 4. Stream references to collections
ALTER TABLE streams ADD COLUMN IF NOT EXISTS video_collection_id UUID REFERENCES media_collections(id) ON DELETE SET NULL;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS audio_collection_id UUID REFERENCES media_collections(id) ON DELETE SET NULL;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS mix_mode TEXT;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS settings_json JSONB DEFAULT '{}'::jsonb;

UPDATE streams
SET mix_mode = COALESCE(mix_mode, 'video_only');

ALTER TABLE streams ALTER COLUMN mix_mode SET DEFAULT 'video_only';
ALTER TABLE streams ALTER COLUMN mix_mode SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'check_stream_mix_mode'
        AND conrelid = 'streams'::regclass
    ) THEN
        ALTER TABLE streams
            ADD CONSTRAINT check_stream_mix_mode
            CHECK (mix_mode IN ('video_only', 'audio_only', 'mixed'));
    END IF;
END
$$;

-- Ensure settings_json defaults to an object
UPDATE streams
SET settings_json = '{}'::jsonb
WHERE settings_json IS NULL;

-- 5. Create collections for legacy playlists
WITH playlist_collections AS (
    INSERT INTO media_collections (user_id, name, description, collection_type, default_loop, allow_shuffle, revision, legacy_playlist_id)
    SELECT p.user_id, p.name, p.description, 'video_background', COALESCE(p.loop, TRUE), FALSE, 1, p.id
    FROM playlists p
    ON CONFLICT (legacy_playlist_id) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            default_loop = EXCLUDED.default_loop,
            allow_shuffle = EXCLUDED.allow_shuffle
    RETURNING id, legacy_playlist_id
), playlist_items_insert AS (
    INSERT INTO collection_items (collection_id, asset_id, position)
    SELECT pc.id, pi.asset_id, pi.position
    FROM playlist_collections pc
    JOIN playlist_items pi ON pi.playlist_id = pc.legacy_playlist_id
    ON CONFLICT DO NOTHING
    RETURNING 1
)
UPDATE streams s
SET video_collection_id = pc.id
FROM playlist_collections pc
WHERE s.playlist_id = pc.legacy_playlist_id;

-- 6. Create collections for direct asset streams
WITH asset_streams AS (
    SELECT s.id AS stream_id,
           s.user_id,
           COALESCE(s.name, 'Stream ' || LEFT(s.id::TEXT, 8)) AS label
    FROM streams s
    WHERE s.source_type = 'assets'
), stream_collections AS (
    INSERT INTO media_collections (user_id, name, description, collection_type, default_loop, allow_shuffle, revision, legacy_stream_id)
    SELECT a.user_id, a.label, NULL, 'video_background', TRUE, FALSE, 1, a.stream_id
    FROM asset_streams a
    ON CONFLICT (legacy_stream_id) DO NOTHING
    RETURNING id, legacy_stream_id
), stream_items AS (
    INSERT INTO collection_items (collection_id, asset_id, position)
    SELECT sc.id, sa.asset_id, sa.position
    FROM stream_collections sc
    JOIN stream_assets sa ON sa.stream_id = sc.legacy_stream_id
    ON CONFLICT DO NOTHING
    RETURNING 1
)
UPDATE streams s
SET video_collection_id = COALESCE(s.video_collection_id, sc.id)
FROM stream_collections sc
WHERE s.id = sc.legacy_stream_id;

-- Ensure remaining streams have mix mode defaults
UPDATE streams
SET mix_mode = 'video_only'
WHERE mix_mode IS NULL;

COMMIT;
