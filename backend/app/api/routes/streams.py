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
from app.models.database import Stream, StreamDestination, Playlist, Destination, PlaylistItem, StreamAsset, Asset
from app.schemas.api import (
    StreamResponse,
    StreamCreate,
    StreamStatus,
    StreamLogsResponse,
    StreamQualityResponse,
)
from fastapi import Query
from app.streaming.ffmpeg_manager import ffmpeg_manager
from app.streaming.playlist_builder import PlaylistBuilder
from app.core.security import decrypt_stream_key
from app.core.config import settings
from app.core.quota import QuotaEnforcer

logger = logging.getLogger(__name__)
router = APIRouter()


async def _load_stream_with_relations(
    db: AsyncSession, user_id: UUID, stream_id: UUID
) -> Stream:
    query = (
        select(Stream)
        .where(
            Stream.id == stream_id,
            Stream.user_id == user_id,
        )
        .options(
            selectinload(Stream.playlist).selectinload(Playlist.items).selectinload(PlaylistItem.asset),
            selectinload(Stream.stream_assets).selectinload(StreamAsset.asset),
            selectinload(Stream.stream_destinations).selectinload(StreamDestination.destination),
        )
    )

    result = await db.execute(query)
    return result.scalar_one_or_none()


def _extract_stream_assets(stream: Stream):
    if stream.source_type == "playlist":
        if not stream.playlist:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Playlist is missing for this stream",
            )
        items = sorted(stream.playlist.items, key=lambda x: x.position)
        assets_data = [
            {
                "path": item.asset.storage_path,
                "meta": item.asset.meta or {},
                "asset_id": str(item.asset.id),
                "filename": item.asset.filename,
                "compatible_for_copy": item.asset.compatible_for_copy,
                "validation_errors": item.asset.validation_errors or [],
            }
            for item in items
        ]
        loop_enabled = stream.playlist.loop
    else:
        links = sorted(stream.stream_assets, key=lambda x: x.position)
        if not links:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No assets linked to the stream",
            )
        assets_data = [
            {
                "path": link.asset.storage_path,
                "meta": link.asset.meta or {},
                "asset_id": str(link.asset.id),
                "filename": link.asset.filename,
                "compatible_for_copy": link.asset.compatible_for_copy,
                "validation_errors": link.asset.validation_errors or [],
            }
            for link in links
        ]
        loop_enabled = True

    return assets_data, loop_enabled


def _asset_is_audio_only(asset: Asset) -> bool:
    meta = asset.meta or {}
    if not isinstance(meta, dict):
        return False

    video_meta = meta.get("video")
    audio_meta = meta.get("audio")
    return audio_meta is not None and not video_meta


@router.get("/", response_model=List[StreamResponse])
async def list_streams(
    user_deps: tuple = Depends(require_user)
):
    """List all streams for current user"""
    db, user_id = user_deps
    
    try:
        query = (
            select(Stream)
            .where(Stream.user_id == user_id)
            .options(
                selectinload(Stream.playlist).selectinload(Playlist.items).selectinload(PlaylistItem.asset),
                selectinload(Stream.stream_assets).selectinload(StreamAsset.asset),
            )
        )
        
        result = await db.execute(query)
        streams = result.scalars().all()
        
        return streams
        
    except Exception as e:
        logger.exception(f"Error listing streams: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list streams: {str(e)}"
        )


@router.post("/", response_model=StreamResponse, status_code=status.HTTP_201_CREATED)
async def create_stream(
    stream_data: StreamCreate,
    user_deps: tuple = Depends(require_user)
):
    """Create a new stream configuration"""
    db, user_id = user_deps
    
    try:
        playlist = None
        selected_assets: List[Asset] = []

        if stream_data.playlist_id:
            playlist_query = select(Playlist).where(
                Playlist.id == stream_data.playlist_id,
                Playlist.user_id == user_id
            )
            result = await db.execute(playlist_query)
            playlist = result.scalar_one_or_none()

            if not playlist:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Playlist not found"
                )
        else:
            asset_ids = stream_data.asset_ids or []
            if not asset_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="At least one asset must be selected"
                )

            assets_query = select(Asset).where(
                Asset.user_id == user_id,
                Asset.id.in_(asset_ids)
            )
            result = await db.execute(assets_query)
            fetched_assets = result.scalars().all()

            if len(fetched_assets) != len(set(asset_ids)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="One or more assets were not found"
                )

            # Preserve order from payload
            asset_lookup = {str(asset.id): asset for asset in fetched_assets}
            try:
                selected_assets = [asset_lookup[str(asset_id)] for asset_id in asset_ids]
            except KeyError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Asset selection contains duplicates or invalid IDs"
                )

            invalid_assets = [asset for asset in selected_assets if _asset_is_audio_only(asset)]
            if invalid_assets:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "error": "invalid_asset_type",
                        "message": "Audio-only assets cannot be used as video backgrounds.",
                        "asset_ids": [str(asset.id) for asset in invalid_assets],
                    },
                )

        source_type = "playlist" if playlist else "assets"

        stream = Stream(
            user_id=user_id,
            playlist_id=playlist.id if playlist else None,
            source_type=source_type,
            name=stream_data.name,
            status="stopped"
        )

        db.add(stream)
        await db.flush()

        if source_type == "assets":
            for position, asset in enumerate(selected_assets):
                stream_asset = StreamAsset(
                    stream_id=stream.id,
                    asset_id=asset.id,
                    position=position
                )
                db.add(stream_asset)

        for dest_id in stream_data.destination_ids:
            dest_query = select(Destination).where(
                Destination.id == dest_id,
                Destination.user_id == user_id
            )
            dest_result = await db.execute(dest_query)
            destination = dest_result.scalar_one_or_none()

            if not destination:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Destination {dest_id} not found"
                )

            stream_dest = StreamDestination(
                stream_id=stream.id,
                destination_id=dest_id
            )
            db.add(stream_dest)

        await db.commit()

        loaded_stream = await _load_stream_with_relations(db, user_id, stream.id)
        if not loaded_stream:
            logger.error("Stream %s not found after creation for user %s", stream.id, user_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Stream created but could not be loaded"
            )

        logger.info(f"Created stream {stream.id} for user {user_id}")

        return loaded_stream
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error creating stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create stream: {str(e)}"
        )


@router.get("/{stream_id}/quality", response_model=StreamQualityResponse)
async def stream_quality(
    stream_id: UUID,
    user_deps: tuple = Depends(require_user),
) -> StreamQualityResponse:
    """Return quality evaluation for a stream's source assets."""
    db, user_id = user_deps

    stream = await _load_stream_with_relations(db, user_id, stream_id)
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream not found",
        )

    assets_data, _ = _extract_stream_assets(stream)

    enforcer = QuotaEnforcer(db, user_id)
    quality = await enforcer.evaluate_stream_quality(assets_data)

    return StreamQualityResponse(
        ok=quality["ok"],
        tier=quality["tier"],
        limits=quality["limits"],
        violations=quality["violations"],
        recommended=quality.get("recommended"),
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
        # Check quota for concurrent streams
        enforcer = QuotaEnforcer(db, user_id)
        await enforcer.check_concurrent_streams()
        
        # Get stream with all related data
        stream = await _load_stream_with_relations(db, user_id, stream_id)

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
        
        assets_data, loop_enabled = _extract_stream_assets(stream)

        quality = await enforcer.evaluate_stream_quality(assets_data)
        if not quality["ok"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "error": "quality_rejected",
                    **quality,
                },
            )

        compatible, issues = PlaylistBuilder.validate_playlist_assets(assets_data)
        if not compatible:
            logger.warning("Stream %s failed validation: %s", stream_id, issues)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "Playlist assets are incompatible",
                    "issues": issues,
                },
            )
        
        PlaylistBuilder.build_playlist_file(assets_data, playlist_file, loop_enabled)
        
        # Prepare destinations with decrypted keys
        destinations = []
        for stream_dest in stream.stream_destinations:
            dest = stream_dest.destination
            if dest.enabled:
                decrypted_key = decrypt_stream_key(dest.stream_key_encrypted)
                normalized_url = (dest.rtmps_url or "").strip().rstrip("/")
                if not normalized_url:
                    logger.warning(
                        "Destination %s for stream %s has no RTMP(S) URL, skipping",
                        dest.id,
                        stream.id,
                    )
                    continue
                destinations.append({
                    "url": normalized_url,
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
            log_file,
            metadata={
                "user_id": user_id,
                "stream_id": str(stream.id),
                "playlist_id": str(stream.playlist_id) if stream.playlist_id else None,
            },
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
        logger.exception(f"Error starting stream: {e}")
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
        query = select(Stream).where(
            Stream.id == stream_id,
            Stream.user_id == user_id
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
        logger.exception(f"Error stopping stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stop stream: {str(e)}"
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
        query = select(Stream).where(
            Stream.id == stream_id,
            Stream.user_id == user_id
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
        logger.exception(f"Error getting stream status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get stream status: {str(e)}"
        )


@router.get("/{stream_id}/logs", response_model=StreamLogsResponse)
async def get_stream_logs(
    stream_id: UUID,
    lines: int = Query(default=100, ge=1, le=10000, description="Number of log lines (1-10000)"),
    user_deps: tuple = Depends(require_user)
):
    """Get stream logs (last N lines with validation)"""
    db, user_id = user_deps
    
    try:
        # Get stream
        query = select(Stream).where(
            Stream.id == stream_id,
            Stream.user_id == user_id
        )
        result = await db.execute(query)
        stream = result.scalar_one_or_none()
        
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found"
            )
        
        if not stream.log_path or not Path(stream.log_path).exists():
            return StreamLogsResponse(
                stream_id=stream_id,
                logs=[],
                total_lines=0
            )
        
        # Read last N lines of log file
        log_file = Path(stream.log_path)
        with open(log_file, 'r') as f:
            all_lines = f.readlines()
            last_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
        
        return StreamLogsResponse(
            stream_id=stream_id,
            logs=[line.strip() for line in last_lines],
            total_lines=len(all_lines)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting stream logs: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get stream logs: {str(e)}"
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
        query = select(Stream).where(
            Stream.id == stream_id,
            Stream.user_id == user_id
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
        logger.exception(f"Error deleting stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete stream: {str(e)}"
        )
