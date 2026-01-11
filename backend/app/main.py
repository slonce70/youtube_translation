import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from fastapi.staticfiles import StaticFiles
from starlette_csrf import CSRFMiddleware

from app.core.config import settings

# Sentry integration for error tracking
if settings.sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=0.1 if settings.environment == "production" else 1.0,
        profiles_sample_rate=0.1 if settings.environment == "production" else 1.0,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
        ],
        send_default_pii=False,  # Don't send personally identifiable information
        before_send=lambda event, hint: event if settings.environment != "development" else None,
    )
    logging.getLogger(__name__).info(f"Sentry initialized for environment: {settings.environment}")
from app.api.routes import (
    auth,
    assets,
    playlists,
    destinations,
    streams,
    metrics,
    quota,
    admin,
    monitoring,
    media_folders,
    media_collections,
)
from app.middleware.rate_limiter import RateLimitMiddleware, global_rate_limiter
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.middleware.api_metrics import APIMetricsMiddleware
from app.core.logging_config import setup_logging, get_logger
from app.streaming.ffmpeg_manager import ffmpeg_manager
from app.services.streams.scheduler import scheduled_stream_launcher


_background_tasks = set()


def schedule_background_task(coro):
    """Central helper so tests can spy on tasks without patching asyncio globally."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task

# Configure structured logging
setup_logging(level="INFO", json_output=settings.environment == "production")
logger = get_logger(__name__)

# Create FastAPI app
app = FastAPI(
    title="YouTube Multi-Channel Streaming API",
    description="24/7 streaming service for multiple YouTube channels",
    version="1.0.0",
    default_response_class=ORJSONResponse,
)

# Security headers middleware (first)
app.add_middleware(SecurityHeadersMiddleware)

# Metrics/logging middleware (after headers so tracing includes CSP additions)
app.add_middleware(APIMetricsMiddleware)

# Rate limiting middleware (before CORS)
app.add_middleware(RateLimitMiddleware, rate_limiter=global_rate_limiter)

# CSRF protection middleware
app.add_middleware(
    CSRFMiddleware,
    secret=(settings.csrf_secret or settings.encryption_key),
    sensitive_cookies={"csrftoken", "sb-access-token", "sb-refresh-token"},
    header_name="X-CSRF-Token",
    cookie_name="csrftoken",
    cookie_path="/",
    cookie_secure=settings.environment == "production",
    cookie_samesite="lax",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(quota.router, prefix="/api", tags=["quota"])  # Quota management
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])  # Admin panel
app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
app.include_router(playlists.router, prefix="/api/playlists", tags=["playlists"])
app.include_router(destinations.router, prefix="/api/destinations", tags=["destinations"])
app.include_router(streams.router, prefix="/api/streams", tags=["streams"])
app.include_router(media_folders.router, prefix="/api/media-folders", tags=["media-folders"])
app.include_router(media_collections.router, prefix="/api/media-collections", tags=["media-collections"])
app.include_router(metrics.router, prefix="/api", tags=["metrics"])
app.include_router(monitoring.router, prefix="/api/monitoring", tags=["monitoring"])

# Mount static files for thumbnails
thumbnails_dir = Path(settings.upload_dir) / "thumbnails"
thumbnails_dir.mkdir(parents=True, exist_ok=True)
app.mount("/thumbnails", StaticFiles(directory=str(thumbnails_dir)), name="thumbnails")


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup"""
    from app.core.database import check_db_connection, apply_schema_patches, async_session_maker
    from app.core.stream_reconciler import reconcile_streams
    
    logger.info("Starting YouTube Multi-Channel Streaming Service")
    logger.info(f"FFmpeg: {settings.ffmpeg_bin}")
    logger.info(f"Upload dir: {settings.upload_dir}")
    logger.info(f"Stream dir: {settings.stream_dir}")
    logger.info(f"Stream runtime mode: {settings.stream_runtime_mode}")
    
    # Check database connection
    await check_db_connection()
    await apply_schema_patches()

    # Reconcile stream statuses after backend restart
    async with async_session_maker() as db:
        reconciliation_result = await reconcile_streams(db)
        logger.info(f"Reconciliation result: {reconciliation_result}")

    # Start periodic cleanup task for rate limiter
    schedule_background_task(cleanup_rate_limiter())
    schedule_background_task(cleanup_ffmpeg_streams())
    schedule_background_task(scheduled_stream_launcher())
    
    # Start periodic stream status sync (only in supervisor/systemd mode)
    if settings.stream_runtime_mode in ("supervisor", "systemd"):
        schedule_background_task(periodic_stream_status_sync())


async def cleanup_rate_limiter():
    """Periodically cleanup old rate limiter entries"""
    while True:
        await asyncio.sleep(300)  # Every 5 minutes
        try:
            global_rate_limiter.cleanup_old_entries()
        except Exception as e:
            logger.error(f"Error cleaning up rate limiter: {e}")


async def cleanup_ffmpeg_streams():
    """Periodically remove stale FFmpeg stream metadata from the manager cache."""
    interval = max(getattr(settings, "ffmpeg_cleanup_interval_seconds", 60), 5)
    while True:
        await asyncio.sleep(interval)
        try:
            await ffmpeg_manager.cleanup_dead_streams()
        except Exception as exc:
            logger.error(f"Error cleaning up FFmpeg streams: {exc}")


async def periodic_stream_status_sync():
    """Periodically sync stream statuses with supervisor/systemd (every 10 seconds)."""
    from app.core.database import async_session_maker
    from app.core.stream_reconciler import periodic_reconciliation
    
    await asyncio.sleep(10)  # Initial delay
    
    while True:
        await asyncio.sleep(10)  # Every 10 seconds (was 30 - too slow!)
        try:
            async with async_session_maker() as db:
                await periodic_reconciliation(db)
        except Exception as exc:
            logger.error(f"Error syncing stream statuses: {exc}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down...")


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "YouTube Multi-Channel Streaming API",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True,
        log_level="info"
    )
