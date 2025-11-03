from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from typing import List
from uuid import UUID
from pathlib import Path
from datetime import datetime
import logging

from app.api.deps import require_user
from app.models.database import Stream, StreamDestination, Project, Playlist, Destination, PlaylistItem
from app.schemas.api import StreamResponse, StreamCreate, StreamStatus
from app.streaming.ffmpeg_manager import ffmpeg_manager
from app.streaming.playlist_builder import PlaylistBuilder
from app.core.security import decrypt_stream_key
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/", response_model=List[StreamResponse])
async def list_streams(
    project_id: UUID = None,
    user_deps: tuple = Depends(require_user)
):
    """List all streams for current user"""
    db, user_id = user_deps
    
    try:
        query = select(Stream).join(Project).where(Project.user_id == user_id)
        
        if project_id:
            query = query.where(Stream.project_id == project_id)
        
        result = await db.execute(query)
        streams = result.scalars().all()
        
        return streams
        
    except Exception as e:
        logger.error(f"Error listing streams: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list streams"
        )


@router.post("/", response_model=StreamResponse, status_code=status.HTTP_201_CREATED)
async def create_stream(
    stream_data: StreamCreate,
    user_deps: tuple = Depends(require_user)
):
    """Create a new stream configuration"""
    db, user_id = user_deps
    
    try:
        # Verify project belongs to user
        project_query = select(Project).where(
            Project.id == stream_data.project_id,
            Project.user_id == user_id
        )
        result = await db.execute(project_query)
        project = result.scalar_one_or_none()
        
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found"
            )
        
        # Verify playlist belongs to project
        playlist_query = select(Playlist).where(
            Playlist.id == stream_data.playlist_id,
            Playlist.project_id == stream_data.project_id
        )
        result = await db.execute(playlist_query)
        playlist = result.scalar_one_or_none()
        
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Playlist not found"
            )
        
        # Create stream
        stream = Stream(
            project_id=stream_data.project_id,
            playlist_id=stream_data.playlist_id,
            name=stream_data.name,
            status="stopped"
        )
        
        db.add(stream)
        await db.flush()  # Get stream ID
        
        # Add stream destinations
        for dest_id in stream_data.destination_ids:
            # Verify destination belongs to project
            dest_query = select(Destination).where(
                Destination.id == dest_id,
                Destination.project_id == stream_data.project_id
            )
            dest_result = await db.execute(dest_query)
            destination = dest_result.scalar_one_or_none()
            
            if not destination:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Destination {dest_id} not found in project"
                )
            
            stream_dest = StreamDestination(
                stream_id=stream.id,
                destination_id=dest_id
            )
            db.add(stream_dest)
        
        await db.commit()
        await db.refresh(stream)
        
        logger.info(f"Created stream {stream.id} for user {user_id}")
        
        return stream
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create stream"
        )


@router.post("/{stream_id}/start", response_model=StreamStatus)
async def start_stream(
    stream_id: UUID,
    background_tasks: BackgroundTasks,
    user_deps: tuple = Depends(require_user)
):
    """Start streaming to YouTube channels with FFmpeg"""
    db, user_id = user_deps
    
    try:
        # Get stream with all related data
        query = (
            select(Stream)
            .join(Project)
            .where(
                Stream.id == stream_id,
                Project.user_id == user_id
            )
            .options(
                selectinload(Stream.playlist).selectinload(Playlist.items).selectinload(PlaylistItem.asset),
                selectinload(Stream.stream_destinations).selectinload(StreamDestination.destination)
            )
        )
        
        result = await db.execute(query)
        stream = result.scalar_one_or_none()
        
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found"
            )
        
        # Check if already running
        if ffmpeg_manager.is_running(str(stream_id)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stream is already running"
            )
        
        # Prepare playlist file
        stream_dir = Path(settings.stream_dir) / str(stream_id)
        stream_dir.mkdir(parents=True, exist_ok=True)
        
        playlist_file = stream_dir / "playlist.txt"
        log_file = stream_dir / "stream.log"
        
        # Build playlist
        assets_data = [
            {"path": item.asset.storage_path}
            for item in sorted(stream.playlist.items, key=lambda x: x.position)
        ]
        
        PlaylistBuilder.build_playlist_file(assets_data, playlist_file, stream.playlist.loop)
        
        # Prepare destinations with decrypted keys
        destinations = []
        for stream_dest in stream.stream_destinations:
            dest = stream_dest.destination
            if dest.enabled:
                decrypted_key = decrypt_stream_key(dest.stream_key_encrypted)
                destinations.append({
                    "url": dest.rtmps_url,
                    "key": decrypted_key
                })
        
        if not destinations:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No enabled destinations found"
            )
        
        # Start FFmpeg process
        success = await ffmpeg_manager.start_stream(
            str(stream_id),
            playlist_file,
            destinations,
            log_file
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to start stream"
            )
        
        # Update stream status
        stream.status = "running"
        stream.started_at = datetime.utcnow()
        stream.stopped_at = None
        stream.error_message = None
        stream.log_path = str(log_file)
        stream.pid = ffmpeg_manager.get_stream_info(str(stream_id))["pid"]
        
        await db.commit()
        
        logger.info(f"Started stream {stream_id}")
        
        return StreamStatus(
            id=stream_id,
            status="running",
            uptime_seconds=0,
            is_running=True
        )
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error starting stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start stream: {str(e)}"
        )


@router.post("/{stream_id}/stop", response_model=StreamStatus)
async def stop_stream(
    stream_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Stop streaming"""
    db, user_id = user_deps
    
    try:
        # Get stream
        query = select(Stream).join(Project).where(
            Stream.id == stream_id,
            Project.user_id == user_id
        )
        result = await db.execute(query)
        stream = result.scalar_one_or_none()
        
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found"
            )
        
        # Stop FFmpeg process
        success = await ffmpeg_manager.stop_stream(str(stream_id))
        
        # Update stream status
        stream.status = "stopped"
        stream.stopped_at = datetime.utcnow()
        stream.pid = None
        
        await db.commit()
        
        logger.info(f"Stopped stream {stream_id}")
        
        return StreamStatus(
            id=stream_id,
            status="stopped",
            uptime_seconds=0,
            is_running=False
        )
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error stopping stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to stop stream"
        )


@router.get("/{stream_id}/status", response_model=StreamStatus)
async def get_stream_status(
    stream_id: UUID,
    user_deps: tuple = Depends(require_user)
) -> StreamStatus:
    """Get stream status"""
    db, user_id = user_deps
    
    try:
        # Get stream from database
        query = select(Stream).join(Project).where(
            Stream.id == stream_id,
            Project.user_id == user_id
        )
        result = await db.execute(query)
        stream = result.scalar_one_or_none()
        
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found"
            )
        
        # Get live status from manager
        is_running = ffmpeg_manager.is_running(str(stream_id))
        stream_info = ffmpeg_manager.get_stream_info(str(stream_id))
        
        uptime_seconds = 0
        if is_running and stream_info and "uptime_seconds" in stream_info:
            uptime_seconds = stream_info["uptime_seconds"]
        
        return StreamStatus(
            id=stream_id,
            status=stream.status,
            uptime_seconds=uptime_seconds,
            is_running=is_running,
            error_message=stream.error_message
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting stream status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get stream status"
        )


@router.get("/{stream_id}/logs")
async def get_stream_logs(
    stream_id: UUID,
    lines: int = 100,
    user_deps: tuple = Depends(require_user)
):
    """Get stream logs (last N lines)"""
    db, user_id = user_deps
    
    try:
        # Get stream
        query = select(Stream).join(Project).where(
            Stream.id == stream_id,
            Project.user_id == user_id
        )
        result = await db.execute(query)
        stream = result.scalar_one_or_none()
        
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found"
            )
        
        if not stream.log_path or not Path(stream.log_path).exists():
            return {"logs": []}
        
        # Read last N lines of log file
        log_file = Path(stream.log_path)
        with open(log_file, 'r') as f:
            all_lines = f.readlines()
            last_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
        
        return {
            "stream_id": stream_id,
            "logs": [line.strip() for line in last_lines]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting stream logs: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get stream logs"
        )


@router.delete("/{stream_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stream(
    stream_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Delete stream configuration"""
    db, user_id = user_deps
    
    try:
        # Get stream
        query = select(Stream).join(Project).where(
            Stream.id == stream_id,
            Project.user_id == user_id
        )
        result = await db.execute(query)
        stream = result.scalar_one_or_none()
        
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found"
            )
        
        # Stop if running
        if ffmpeg_manager.is_running(str(stream_id)):
            await ffmpeg_manager.stop_stream(str(stream_id))
        
        # Delete stream directory
        stream_dir = Path(settings.stream_dir) / str(stream_id)
        if stream_dir.exists():
            import shutil
            shutil.rmtree(stream_dir)
        
        # Delete from database
        await db.execute(delete(Stream).where(Stream.id == stream_id))
        await db.commit()
        
        logger.info(f"Deleted stream {stream_id}")
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete stream"
        )
