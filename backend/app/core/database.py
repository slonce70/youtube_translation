from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from sqlalchemy.pool import NullPool
from contextlib import asynccontextmanager
import asyncio
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

# Convert PostgreSQL URL to async version
DATABASE_URL = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")

# Create async engine
engine_kwargs = {
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

engine = create_async_engine(
    DATABASE_URL,
    **engine_kwargs
)

# Backwards-compatible export expected by older modules/tests
async_engine = engine

# Create async session factory
async_session_maker = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


_db_connection_semaphore = asyncio.Semaphore(max(settings.db_pool_size, 1))


@asynccontextmanager
async def _managed_session():
    async with _db_connection_semaphore:
        async with async_session_maker() as session:
            try:
                yield session
            except Exception as e:
                await session.rollback()
                logger.exception(f"Database error, rolling back: {e}")
                raise
            else:
                try:
                    await session.commit()
                except Exception as e:
                    await session.rollback()
                    logger.exception(f"Commit failed, rolling back: {e}")
                    raise
            finally:
                await session.close()


async def get_db() -> AsyncSession:
    """
    Dependency for getting database session.
    Commits only on success, rolls back on error.
    
    Usage in FastAPI:
        @app.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with _managed_session() as session:
        yield session


@asynccontextmanager
async def get_db_context():
    """
    Context manager for database session.
    Commits only on success, rolls back on error.
    
    Usage:
        async with get_db_context() as db:
            result = await db.execute(...)
    """
    async with _managed_session() as session:
        yield session


async def init_db():
    """Initialize database - create tables if they don't exist"""
    from app.models.database import Base

    async with engine.begin() as conn:
        # await conn.run_sync(Base.metadata.drop_all)  # Uncomment to drop all tables
        await conn.run_sync(Base.metadata.create_all)
        await _apply_schema_patches(conn)

    logger.info("Database initialized")


async def _apply_schema_patches(conn):
    """Apply idempotent schema updates for new columns."""
    await conn.execute(
        text(
            """
            ALTER TABLE subscription_tier_limits
            ADD COLUMN IF NOT EXISTS max_resolution_height INTEGER,
            ADD COLUMN IF NOT EXISTS max_fps INTEGER,
            ADD COLUMN IF NOT EXISTS max_video_bitrate_mbps INTEGER,
            ADD COLUMN IF NOT EXISTS min_video_bitrate_mbps INTEGER,
            ADD COLUMN IF NOT EXISTS enforce_stream_quality BOOLEAN DEFAULT TRUE
            """
        )
    )

    # Ensure defaults for existing rows
    await conn.execute(
        text(
            """
            UPDATE subscription_tier_limits
            SET
                enforce_stream_quality = COALESCE(enforce_stream_quality, TRUE)
            """
        )
    )

    # Free tier defaults aligned with YouTube FullHD recommendations
    await conn.execute(
        text(
            """
            UPDATE subscription_tier_limits
            SET
                max_resolution_height = COALESCE(max_resolution_height, 1080),
                max_fps = COALESCE(max_fps, 30),
                min_video_bitrate_mbps = COALESCE(min_video_bitrate_mbps, 3),
                max_video_bitrate_mbps = COALESCE(max_video_bitrate_mbps, 10)
            WHERE tier = 'free'
            """
        )
    )

    # Higher tiers keep wide limits unless explicitly set later
    await conn.execute(
        text(
            """
            UPDATE subscription_tier_limits
            SET enforce_stream_quality = TRUE
            WHERE enforce_stream_quality IS NULL
            """
        )
    )

    # Ensure legacy databases enforce a single root folder per user
    await conn.execute(
        text(
            """
            DO $$
            BEGIN
                IF to_regclass('media_folders') IS NOT NULL THEN
                    WITH ranked AS (
                        SELECT
                            id,
                            user_id,
                            ROW_NUMBER() OVER (
                                PARTITION BY user_id
                                ORDER BY created_at NULLS LAST, id
                            ) AS row_rank,
                            FIRST_VALUE(id) OVER (
                                PARTITION BY user_id
                                ORDER BY created_at NULLS LAST, id
                            ) AS primary_id
                        FROM media_folders
                        WHERE is_root
                    )
                    UPDATE asset_folder_links afl
                    SET folder_id = ranked.primary_id
                    FROM ranked
                    WHERE afl.folder_id = ranked.id
                      AND ranked.row_rank > 1;

                    WITH ranked AS (
                        SELECT
                            id,
                            user_id,
                            ROW_NUMBER() OVER (
                                PARTITION BY user_id
                                ORDER BY created_at NULLS LAST, id
                            ) AS row_rank
                        FROM media_folders
                        WHERE is_root
                    )
                    DELETE FROM media_folders mf
                    USING ranked
                    WHERE mf.id = ranked.id
                      AND ranked.row_rank > 1;

                    IF to_regclass('idx_media_folders_user_root') IS NULL THEN
                        EXECUTE '
                            CREATE UNIQUE INDEX idx_media_folders_user_root
                            ON media_folders(user_id)
                            WHERE is_root
                        ';
                    END IF;
                END IF;
            END $$;
            """
        )
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
