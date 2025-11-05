from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
import logging
import asyncio

from app.core.config import settings
from app.api.routes import auth, assets, playlists, destinations, streams, metrics, quota, admin, monitoring
from app.middleware.rate_limiter import RateLimitMiddleware, global_rate_limiter
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.core.logging_config import setup_logging, get_logger

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

# Rate limiting middleware (before CORS)
app.add_middleware(RateLimitMiddleware, rate_limiter=global_rate_limiter)

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
app.include_router(metrics.router, prefix="/api", tags=["metrics"])
app.include_router(monitoring.router, prefix="/api/monitoring", tags=["monitoring"])


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup"""
    from app.core.database import check_db_connection, apply_schema_patches
    
    logger.info("Starting YouTube Multi-Channel Streaming Service")
    logger.info(f"FFmpeg: {settings.ffmpeg_bin}")
    logger.info(f"Upload dir: {settings.upload_dir}")
    logger.info(f"Stream dir: {settings.stream_dir}")
    
    # Check database connection
    await check_db_connection()
    await apply_schema_patches()
    
    # Start periodic cleanup task for rate limiter
    asyncio.create_task(cleanup_rate_limiter())


async def cleanup_rate_limiter():
    """Periodically cleanup old rate limiter entries"""
    while True:
        await asyncio.sleep(300)  # Every 5 minutes
        try:
            global_rate_limiter.cleanup_old_entries()
        except Exception as e:
            logger.error(f"Error cleaning up rate limiter: {e}")


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
