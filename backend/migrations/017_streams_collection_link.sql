-- Migration 017: Link streams to media collections and introduce mix settings

ALTER TABLE streams
    ADD COLUMN IF NOT EXISTS video_collection_id UUID REFERENCES media_collections(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS audio_collection_id UUID REFERENCES media_collections(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS mix_mode TEXT,
    ADD COLUMN IF NOT EXISTS settings_json JSONB;

-- Backfill defaults
UPDATE streams
SET mix_mode = COALESCE(mix_mode, 'video_only');

UPDATE streams
SET settings_json = COALESCE(settings_json, '{}'::jsonb);

ALTER TABLE streams
    ALTER COLUMN mix_mode SET DEFAULT 'video_only';

ALTER TABLE streams
    ALTER COLUMN mix_mode SET NOT NULL;

ALTER TABLE streams
    ALTER COLUMN settings_json SET DEFAULT '{}'::jsonb;

ALTER TABLE streams
    ALTER COLUMN settings_json SET NOT NULL;

-- Ensure mix_mode only stores supported values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'streams'
          AND constraint_name = 'check_stream_mix_mode'
    ) THEN
        ALTER TABLE streams
            ADD CONSTRAINT check_stream_mix_mode
            CHECK (mix_mode IN ('video_only', 'audio_only', 'mixed'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_streams_video_collection ON streams(video_collection_id);
CREATE INDEX IF NOT EXISTS idx_streams_audio_collection ON streams(audio_collection_id);

COMMENT ON COLUMN streams.video_collection_id IS 'Selected video media collection for the stream.';
COMMENT ON COLUMN streams.audio_collection_id IS 'Selected audio media collection for the stream.';
COMMENT ON COLUMN streams.mix_mode IS 'Stream mixing mode: video_only, audio_only, or mixed.';
COMMENT ON COLUMN streams.settings_json IS 'Serialized stream configuration (per-stream overrides).';

-- Auto-create collections for existing playlists to preserve legacy data
WITH missing_collections AS (
    SELECT p.id            AS playlist_id,
           p.user_id       AS user_id,
           NULLIF(p.name, '') AS playlist_name,
           p.description   AS description
    FROM playlists p
    WHERE NOT EXISTS (
        SELECT 1
        FROM media_collections mc
        WHERE mc.origin_playlist_id = p.id
    )
)
INSERT INTO media_collections (id, user_id, name, collection_type, description, origin_playlist_id, is_active, created_at, updated_at)
SELECT uuid_generate_v4(),
       m.user_id,
       COALESCE(m.playlist_name, 'Playlist ' || LEFT(m.playlist_id::text, 8)),
       'video_background',
       m.description,
       m.playlist_id,
       TRUE,
       NOW(),
       NOW()
FROM missing_collections m;

-- Copy playlist items into collection items (preserving order and loop semantics)
WITH copied_items AS (
    SELECT mc.id         AS collection_id,
           pi.asset_id   AS asset_id,
           pi.position   AS position,
           CASE WHEN COALESCE(p.loop, TRUE) THEN 'loop' ELSE 'once' END AS loop_mode
    FROM playlists p
    JOIN media_collections mc
      ON mc.origin_playlist_id = p.id
    JOIN playlist_items pi
      ON pi.playlist_id = p.id
    LEFT JOIN collection_items ci
      ON ci.collection_id = mc.id AND ci.asset_id = pi.asset_id
    WHERE ci.id IS NULL
)
INSERT INTO collection_items (id, collection_id, asset_id, position, loop_mode, created_at, updated_at)
SELECT uuid_generate_v4(),
       copied_items.collection_id,
       copied_items.asset_id,
       copied_items.position,
       copied_items.loop_mode,
       NOW(),
       NOW()
FROM copied_items;

-- Link legacy streams to the newly created video collections
UPDATE streams s
SET video_collection_id = mc.id
FROM media_collections mc
WHERE mc.origin_playlist_id = s.playlist_id
  AND s.video_collection_id IS NULL;
