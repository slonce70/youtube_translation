-- Migration 015: Introduce media folders and asset-folder links

-- Media folders with hierarchical structure
CREATE TABLE IF NOT EXISTS media_folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    parent_id UUID REFERENCES media_folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_root BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure folder names are unique per parent (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_folders_unique_name
    ON media_folders(user_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Only one root folder per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_folders_user_root
    ON media_folders(user_id)
    WHERE is_root;

CREATE INDEX IF NOT EXISTS idx_media_folders_parent_id ON media_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_media_folders_user_id ON media_folders(user_id);

-- Keep updated_at in sync
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE event_object_table = 'media_folders'
          AND trigger_name = 'update_media_folders_updated_at'
    ) THEN
        CREATE TRIGGER update_media_folders_updated_at
            BEFORE UPDATE ON media_folders
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMENT ON TABLE media_folders IS 'Hierarchical virtual folders for organizing user media assets.';

-- Pivot table linking assets to folders (supports multi-folder tagging)
CREATE TABLE IF NOT EXISTS asset_folder_links (
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    folder_id UUID NOT NULL REFERENCES media_folders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (asset_id, folder_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_folder_links_folder ON asset_folder_links(folder_id);

COMMENT ON TABLE asset_folder_links IS 'Associates assets with one or more media folders.';

-- Seed root folders for all known users
INSERT INTO media_folders (user_id, name, is_root)
SELECT up.user_id, 'root', TRUE
FROM user_profiles up
WHERE NOT EXISTS (
    SELECT 1
    FROM media_folders mf
    WHERE mf.user_id = up.user_id
      AND mf.is_root
);

-- Ensure users with assets but no profile still get a root folder
INSERT INTO media_folders (user_id, name, is_root)
SELECT DISTINCT a.user_id, 'root', TRUE
FROM assets a
WHERE NOT EXISTS (
    SELECT 1
    FROM media_folders mf
    WHERE mf.user_id = a.user_id
      AND mf.is_root
);

-- Attach existing assets to their user's root folder
INSERT INTO asset_folder_links (asset_id, folder_id)
SELECT a.id, mf.id
FROM assets a
JOIN media_folders mf
  ON mf.user_id = a.user_id
 AND mf.is_root
LEFT JOIN asset_folder_links afl
  ON afl.asset_id = a.id
WHERE afl.asset_id IS NULL;
