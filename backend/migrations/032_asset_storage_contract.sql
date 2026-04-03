ALTER TABLE assets
ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'filesystem',
ADD COLUMN IF NOT EXISTS storage_key TEXT;

CREATE INDEX IF NOT EXISTS idx_assets_storage_backend
    ON assets(storage_backend);
