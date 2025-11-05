from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from contextlib import asynccontextmanager
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

# Convert PostgreSQL URL to async version
DATABASE_URL = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")

# Create async engine
engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # Set to True for SQL query logging
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10
)

# Backwards-compatible export expected by older modules/tests
async_engine = engine

# Create async session factory
async_session_maker = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


async def get_db() -> AsyncSession:
    """
    Dependency for getting database session.
    Commits only on success, rolls back on error.
    
    Usage in FastAPI:
        @app.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with async_session_maker() as session:
        try:
            yield session
        except Exception as e:
            await session.rollback()
            logger.exception(f"Database error, rolling back: {e}")
            raise
        else:
            # Only commit if no exception occurred
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                logger.exception(f"Commit failed, rolling back: {e}")
                raise
        finally:
            await session.close()


@asynccontextmanager
async def get_db_context():
    """
    Context manager for database session.
    Commits only on success, rolls back on error.
    
    Usage:
        async with get_db_context() as db:
            result = await db.execute(...)
    """
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
