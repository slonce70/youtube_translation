-- Migration 012: Create stream_assets table for asset-based streams

CREATE TABLE IF NOT EXISTS stream_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_assets_stream_id ON stream_assets(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_assets_asset_id ON stream_assets(asset_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_assets_stream_position ON stream_assets(stream_id, position);
