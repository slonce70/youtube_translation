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
    
    logger.info("Database initialized")


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
