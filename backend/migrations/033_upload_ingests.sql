CREATE TABLE IF NOT EXISTS upload_ingests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    upload_id TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    filename TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    storage_backend TEXT NOT NULL DEFAULT 'filesystem',
    storage_key TEXT,
    local_path TEXT,
    error_code TEXT,
    error_message TEXT,
    validation_errors TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    warning_messages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    attempt_count INTEGER NOT NULL DEFAULT 0,
    received_at TIMESTAMPTZ,
    finalized_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT check_upload_ingest_status
        CHECK (status IN ('received', 'validating', 'finalized', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_upload_ingests_user_id
    ON upload_ingests(user_id);

CREATE INDEX IF NOT EXISTS idx_upload_ingests_user_status
    ON upload_ingests(user_id, status);

ALTER TABLE upload_ingests
    ALTER COLUMN validation_errors SET DEFAULT ARRAY[]::TEXT[],
    ALTER COLUMN warning_messages SET DEFAULT ARRAY[]::TEXT[];

UPDATE upload_ingests
SET
    validation_errors = COALESCE(validation_errors, ARRAY[]::TEXT[]),
    warning_messages = COALESCE(warning_messages, ARRAY[]::TEXT[])
WHERE validation_errors IS NULL OR warning_messages IS NULL;
