ALTER TABLE assets
ADD COLUMN IF NOT EXISTS optimization_status TEXT NOT NULL DEFAULT 'not_requested',
ADD COLUMN IF NOT EXISTS optimization_strategy TEXT,
ADD COLUMN IF NOT EXISTS optimized_storage_path TEXT,
ADD COLUMN IF NOT EXISTS optimization_error TEXT,
ADD COLUMN IF NOT EXISTS optimization_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_assets_optimization_status ON assets(optimization_status);
