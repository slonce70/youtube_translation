from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
import asyncio
import logging
from typing import Any

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
from sqlalchemy.pool import NullPool

from fastapi import HTTPException

from app.core.config import settings

logger = logging.getLogger(__name__)

SCHEMA_PATCH_LOCK_ID = 872634  # Arbitrary advisory lock id to serialize schema patches

# Convert PostgreSQL URL to async version
DATABASE_URL = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")

# Create async engine
engine_kwargs: dict[str, Any] = {
    "echo": settings.db_echo_sql,
    "pool_pre_ping": True,
}

if settings.db_use_null_pool:
    engine_kwargs["poolclass"] = NullPool
else:
    engine_kwargs.update(
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_recycle=settings.db_pool_recycle_seconds,
        pool_use_lifo=True,
    )

engine = create_async_engine(DATABASE_URL, **engine_kwargs)

# Backwards-compatible export expected by older modules/tests
async_engine = engine

# Create async session factory
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


_db_connection_semaphore = asyncio.Semaphore(max(settings.db_pool_size, 1))


@asynccontextmanager
async def _managed_session(commit_on_success: bool = True):
    async with _db_connection_semaphore:
        async with async_session_maker() as session:
            try:
                yield session
            except HTTPException as http_exc:
                await session.rollback()
                status = getattr(http_exc, "status_code", None)
                if status is not None and status < 500:
                    logger.warning(
                        "Database session rolled back due to HTTP %s", status
                    )
                else:
                    logger.exception(
                        "Database error (HTTPException), rolling back: %s", http_exc
                    )
                raise
            except Exception as e:
                await session.rollback()
                logger.exception(f"Database error, rolling back: {e}")
                raise
            else:
                if commit_on_success:
                    try:
                        await session.commit()
                    except Exception as e:
                        await session.rollback()
                        logger.exception(f"Commit failed, rolling back: {e}")
                        raise
            finally:
                await session.close()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency for getting database session.
    Does not commit on success; callers own persistence.
    Rolls back on error and always closes the session.

    Usage in FastAPI:
        @app.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with _managed_session(commit_on_success=False) as session:
        yield session


@asynccontextmanager
async def get_db_context(commit_on_success: bool = True):
    """
    Context manager for database session.
    Commits on success by default, rolls back on error,
    and allows commit behavior to be overridden.

    Usage:
        async with get_db_context() as db:
            result = await db.execute(...)
    """
    async with _managed_session(commit_on_success=commit_on_success) as session:
        yield session


async def init_db():
    """Initialize database - create tables if they don't exist"""
    from app.models.database import Base

    async with engine.begin() as conn:
        # await conn.run_sync(Base.metadata.drop_all)  # Uncomment to drop all tables
        await conn.run_sync(Base.metadata.create_all)
        await _apply_schema_patches(conn)

    logger.info("Database initialized")


async def _missing_columns(conn, table: str, columns: list[str]) -> list[str]:
    """Return which of the requested columns are missing for a given table."""
    if not columns:
        return []

    placeholders = ", ".join(f":col_{idx}" for idx in range(len(columns)))
    query = text(f"""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = :table_name
          AND column_name IN ({placeholders})
        """)

    params = {"table_name": table}
    for idx, column in enumerate(columns):
        params[f"col_{idx}"] = column

    result = await conn.execute(query, params)
    existing = {row[0] for row in result}
    return [column for column in columns if column not in existing]


async def _apply_schema_changes(conn):
    """Apply idempotent schema updates for new columns."""
    # Ensure local auth schema exists for tests/local development
    await conn.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
    await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS auth.users (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                email TEXT NOT NULL UNIQUE,
                raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
            )
            """))

    # Storage accounting is maintained by explicit apply_storage_delta() calls
    # in asset service mutations. Remove the legacy trigger path so init_db
    # environments do not double count storage bytes.
    await conn.execute(
        text("DROP TRIGGER IF EXISTS trigger_update_user_storage ON assets")
    )
    await conn.execute(text("DROP FUNCTION IF EXISTS update_user_storage_usage()"))

    await conn.execute(text("""
            ALTER TABLE subscription_tier_limits
            ADD COLUMN IF NOT EXISTS max_resolution_height INTEGER,
            ADD COLUMN IF NOT EXISTS max_fps INTEGER,
            ADD COLUMN IF NOT EXISTS max_video_bitrate_mbps FLOAT,
            ADD COLUMN IF NOT EXISTS min_video_bitrate_mbps FLOAT,
            ADD COLUMN IF NOT EXISTS enforce_stream_quality BOOLEAN DEFAULT TRUE
            """))

    # Ensure defaults for existing rows
    await conn.execute(text("""
            UPDATE subscription_tier_limits
            SET
                enforce_stream_quality = COALESCE(enforce_stream_quality, TRUE)
            """))

    # Free tier defaults aligned with YouTube FullHD recommendations
    await conn.execute(text("""
            UPDATE subscription_tier_limits
            SET
                max_resolution_height = COALESCE(max_resolution_height, 1080),
                max_fps = COALESCE(max_fps, 30),
                min_video_bitrate_mbps = COALESCE(min_video_bitrate_mbps, 3),
                max_video_bitrate_mbps = COALESCE(max_video_bitrate_mbps, 10)
            WHERE tier = 'free'
            """))

    # Higher tiers keep wide limits unless explicitly set later
    await conn.execute(text("""
            UPDATE subscription_tier_limits
            SET enforce_stream_quality = TRUE
            WHERE enforce_stream_quality IS NULL
            """))

    # 4K tiers should not cap bitrate below YouTube's own 4K60 guidance.
    # Otherwise valid UHD files get blocked during stream launch.
    await conn.execute(text("""
            UPDATE subscription_tier_limits
            SET
                max_resolution_height = COALESCE(max_resolution_height, 2160),
                max_fps = COALESCE(max_fps, 60),
                max_video_bitrate_mbps = GREATEST(COALESCE(max_video_bitrate_mbps, 51), 51)
            WHERE tier IN ('uhd_start', 'uhd_flow', 'uhd_boost')
            """))

    # Add missing columns to streams table only if needed
    streams_columns = [
        "video_collection_id",
        "audio_collection_id",
        "mix_mode",
        "settings_json",
        "total_duration_seconds",
        "schedule_timezone",
        "schedule_repeat",
        "schedule_weekdays",
        "schedule_window_end_time",
        "schedule_stop_after_seconds",
        "runtime_last_heartbeat_at",
    ]
    if await _missing_columns(conn, "streams", streams_columns):
        await conn.execute(text("""
                ALTER TABLE streams
                ADD COLUMN IF NOT EXISTS video_collection_id UUID REFERENCES media_collections(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS audio_collection_id UUID REFERENCES media_collections(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS mix_mode TEXT NOT NULL DEFAULT 'video_only',
                ADD COLUMN IF NOT EXISTS settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                ADD COLUMN IF NOT EXISTS total_duration_seconds FLOAT DEFAULT 0,
                ADD COLUMN IF NOT EXISTS schedule_timezone TEXT,
                ADD COLUMN IF NOT EXISTS schedule_repeat TEXT NOT NULL DEFAULT 'none',
                ADD COLUMN IF NOT EXISTS schedule_weekdays INTEGER[],
                ADD COLUMN IF NOT EXISTS schedule_window_end_time TIME,
                ADD COLUMN IF NOT EXISTS schedule_stop_after_seconds INTEGER,
                ADD COLUMN IF NOT EXISTS runtime_last_heartbeat_at TIMESTAMPTZ
                """))

    await conn.execute(text("DROP INDEX IF EXISTS idx_streams_runtime_owner_id"))
    await conn.execute(
        text("DROP INDEX IF EXISTS idx_streams_runtime_lease_expires_at")
    )
    await conn.execute(text("DROP INDEX IF EXISTS idx_streams_runtime_next_restart_at"))
    # Drop ONLY the four legacy columns migration 036 retired and that no
    # later migration reintroduces. Audit (2026-04-26):
    #   * ``runtime_owner_id``         — added 030, dropped 036, never re-added
    #   * ``runtime_lease_expires_at`` — added 030, dropped 036, never re-added
    #   * ``runtime_next_restart_at``  — added 031, dropped 036, never re-added
    #   * ``runtime_last_restart_at``  — added 031, dropped 036, never re-added
    # Migration 037 reintroduces ``runtime_restart_attempts`` +
    # ``runtime_last_failure_at`` for the persistent FFmpeg restart counter
    # (Sprint 2 H5 — see
    # ``backend/migrations/037_stream_runtime_restart_persistence.sql``), so
    # those two MUST stay out of this DROP list. Until 2026-04-26 this block
    # silently DROPped both newly-reintroduced columns on every backend boot,
    # producing a perpetual ``UndefinedColumnError`` on
    # ``streams.runtime_restart_attempts`` —
    # see ``docs/runbooks/2026-04-25_prod_recovery_database_url.md``.
    #
    # Pinned by ``backend/tests/test_migrations.py::TestApplySchemaChanges
    # RespectsMigration037`` — adding any other ``runtime_*`` column to this
    # DROP list (without first checking the migration files for a later
    # ADD) will fail CI immediately.
    await conn.execute(text("""
            ALTER TABLE streams
            DROP COLUMN IF EXISTS runtime_owner_id,
            DROP COLUMN IF EXISTS runtime_lease_expires_at,
            DROP COLUMN IF EXISTS runtime_next_restart_at,
            DROP COLUMN IF EXISTS runtime_last_restart_at
            """))

    # Add check constraint for mix_mode if not exists
    await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'check_stream_mix_mode'
                ) THEN
                    ALTER TABLE streams ADD CONSTRAINT check_stream_mix_mode
                    CHECK (mix_mode IN ('video_only', 'audio_only', 'mixed'));
                END IF;
            END $$;
            """))

    await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'check_stream_schedule_repeat'
                ) THEN
                    ALTER TABLE streams ADD CONSTRAINT check_stream_schedule_repeat
                    CHECK (schedule_repeat IN ('none', 'daily', 'weekly'));
                END IF;
            END $$;
            """))

    # Add missing statistics columns to destinations table
    destination_columns = [
        "total_streams",
        "total_stream_hours",
        "last_used_at",
        "provider_kind",
        "provider_connection_id",
        "provider_channel_id",
    ]
    if await _missing_columns(conn, "destinations", destination_columns):
        await conn.execute(text("""
                ALTER TABLE destinations
                ADD COLUMN IF NOT EXISTS total_streams INTEGER DEFAULT 0,
                ADD COLUMN IF NOT EXISTS total_stream_hours FLOAT DEFAULT 0,
                ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE,
                ADD COLUMN IF NOT EXISTS provider_kind TEXT,
                ADD COLUMN IF NOT EXISTS provider_connection_id UUID,
                ADD COLUMN IF NOT EXISTS provider_channel_id TEXT
                """))

    await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS youtube_connections (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
                youtube_channel_id TEXT NOT NULL,
                youtube_channel_title TEXT,
                access_token_encrypted TEXT NOT NULL,
                refresh_token_encrypted TEXT,
                token_expires_at TIMESTAMPTZ,
                scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                created_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
                updated_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
                last_sync_at TIMESTAMPTZ,
                last_sync_error TEXT
            )
            """))
    await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_youtube_connections_user_channel
            ON youtube_connections(user_id, youtube_channel_id)
            """))
    await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_destinations_provider_connection_id
            ON destinations(provider_connection_id)
            """))
    await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_destinations_provider_channel_id
            ON destinations(provider_channel_id)
            """))

    await conn.execute(text("""
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
            """))

    await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'check_destination_provider_kind'
                ) THEN
                    ALTER TABLE destinations
                        ADD CONSTRAINT check_destination_provider_kind
                        CHECK (provider_kind IS NULL OR provider_kind IN ('youtube'));
                END IF;
            END $$;
            """))

    await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_destinations_last_used ON destinations(last_used_at)
            """))

    # Ensure a generic updated_at trigger function exists (used by optional DB triggers).
    await conn.execute(text("""
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = timezone('utc', now());
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            """))

    # Ensure collection_items.updated_at exists for older local DBs (pre-2026-01-09).
    await conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name = 'collection_items'
                ) THEN
                    ALTER TABLE collection_items
                        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc', now());

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
                END IF;
            END $$;
            """))

    # Add missing statistics columns to playlists table
    playlist_columns = ["total_duration_seconds", "total_assets"]
    if await _missing_columns(conn, "playlists", playlist_columns):
        await conn.execute(text("""
                ALTER TABLE playlists
                ADD COLUMN IF NOT EXISTS total_duration_seconds FLOAT DEFAULT 0,
                ADD COLUMN IF NOT EXISTS total_assets INTEGER DEFAULT 0
                """))

    # Add missing columns to assets table
    asset_columns = [
        "storage_backend",
        "storage_key",
        "asset_type",
        "video_codec",
        "audio_codec",
        "resolution",
        "bitrate",
        "fps",
        "codec_info",
        "validation_status",
        "optimization_status",
        "optimization_strategy",
        "optimized_storage_path",
        "optimization_error",
        "optimization_updated_at",
    ]
    if await _missing_columns(conn, "assets", asset_columns):
        await conn.execute(text("""
                ALTER TABLE assets
                ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'filesystem',
                ADD COLUMN IF NOT EXISTS storage_key TEXT,
                ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'video',
                ADD COLUMN IF NOT EXISTS video_codec TEXT,
                ADD COLUMN IF NOT EXISTS audio_codec TEXT,
                ADD COLUMN IF NOT EXISTS resolution TEXT,
                ADD COLUMN IF NOT EXISTS bitrate INTEGER,
                ADD COLUMN IF NOT EXISTS fps INTEGER,
                ADD COLUMN IF NOT EXISTS codec_info JSONB,
                ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'pending',
                ADD COLUMN IF NOT EXISTS optimization_status TEXT NOT NULL DEFAULT 'not_requested',
                ADD COLUMN IF NOT EXISTS optimization_strategy TEXT,
                ADD COLUMN IF NOT EXISTS optimized_storage_path TEXT,
                ADD COLUMN IF NOT EXISTS optimization_error TEXT,
                ADD COLUMN IF NOT EXISTS optimization_updated_at TIMESTAMPTZ
                """))

    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_assets_storage_backend ON assets(storage_backend)"
        )
    )

    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_assets_asset_type ON assets(asset_type)")
    )

    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_assets_validation_status ON assets(validation_status)"
        )
    )

    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_assets_optimization_status ON assets(optimization_status)"
        )
    )

    # Add missing columns to subscription_tier_limits table
    await conn.execute(text("""
            ALTER TABLE subscription_tier_limits
            ADD COLUMN IF NOT EXISTS daily_streaming_limit_hours INTEGER,
            ADD COLUMN IF NOT EXISTS calendar_enabled BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS branding_enabled BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS priority_support_level TEXT,
            ADD COLUMN IF NOT EXISTS dedicated_manager BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS allowed_video_codecs TEXT[]
            """))

    # Note: media_folders root constraint removed - managed by application logic


async def _apply_schema_patches(conn):
    """Serialize schema updates with an advisory lock to avoid deadlocks."""
    lock_acquired = False
    try:
        await conn.execute(
            text("SELECT pg_advisory_lock(:lock_id)"),
            {"lock_id": SCHEMA_PATCH_LOCK_ID},
        )
        lock_acquired = True
        await _apply_schema_changes(conn)
    finally:
        if lock_acquired:
            await conn.execute(
                text("SELECT pg_advisory_unlock(:lock_id)"),
                {"lock_id": SCHEMA_PATCH_LOCK_ID},
            )


async def apply_schema_patches():
    """Public helper to run schema patches outside init_db."""
    async with engine.begin() as conn:
        await _apply_schema_patches(conn)


async def close_db():
    """Close database connections"""
    await engine.dispose()
    logger.info("Database connections closed")


async def check_db_connection():
    """Check database connection at startup"""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            logger.info("✅ Database connection successful")
            return True
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        raise
