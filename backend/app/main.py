from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
import logging

from app.core.config import settings
from app.api.routes import auth, assets, playlists, destinations, streams, projects, metrics

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="YouTube Multi-Channel Streaming API",
    description="24/7 streaming service for multiple YouTube channels",
    version="1.0.0",
    default_response_class=ORJSONResponse,
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
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
app.include_router(playlists.router, prefix="/api/playlists", tags=["playlists"])
app.include_router(destinations.router, prefix="/api/destinations", tags=["destinations"])
app.include_router(streams.router, prefix="/api/streams", tags=["streams"])
app.include_router(metrics.router, prefix="/api", tags=["metrics"])


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup"""
    logger.info("Starting YouTube Multi-Channel Streaming Service")
    logger.info(f"FFmpeg: {settings.ffmpeg_bin}")
    logger.info(f"Upload dir: {settings.upload_dir}")
    logger.info(f"Stream dir: {settings.stream_dir}")


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
