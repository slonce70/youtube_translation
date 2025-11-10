from dataclasses import dataclass
from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from pathlib import Path
from datetime import datetime
import logging

from app.api.deps import require_user
from app.models.database import (
    Stream,
    StreamDestination,
    Playlist,
    Destination,
    PlaylistItem,
    StreamAsset,
    Asset,
    MediaCollection,
    CollectionItem,
)
from app.schemas.api import (
    StreamResponse,
    StreamCreate,
    StreamStatus,
    StreamLogsResponse,
    StreamQualityResponse,
    StreamLiveUpdateRequest,
)
from fastapi import Query
from app.streaming.ffmpeg_manager import ffmpeg_manager
from app.streaming.playlist_builder import PlaylistBuilder, PlaylistFileSet
from app.core.security import decrypt_stream_key
from app.core.config import settings
from app.core.quota import QuotaEnforcer
from app.core.collections import (
    normalize_collection_items,
    replace_collection_items,
    validate_collection_assets,
)

logger = logging.getLogger(__name__)
router = APIRouter()


ALLOWED_MIX_MODES = {"video_only", "audio_only", "mixed"}


@dataclass
class StreamAssetSelection:
    video_assets: List[Dict[str, Any]]
    audio_assets: List[Dict[str, Any]]
    mix_mode: str

    def all_assets(self) -> List[Dict[str, Any]]:
        return list(self.video_assets) + list(self.audio_assets)


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
            selectinload(Stream.video_collection)
            .selectinload(MediaCollection.items)
            .selectinload(CollectionItem.asset),
            selectinload(Stream.audio_collection)
            .selectinload(MediaCollection.items)
            .selectinload(CollectionItem.asset),
        )
    )

    result = await db.execute(query)
    return result.scalar_one_or_none()


async def _get_collection_for_user(
    db: AsyncSession,
    user_id: UUID,
    collection_id: UUID,
    expected_type: str,
) -> MediaCollection:
    query = (
        select(MediaCollection)
        .where(
            MediaCollection.id == collection_id,
            MediaCollection.user_id == user_id,
        )
        .options(
            selectinload(MediaCollection.items).selectinload(CollectionItem.asset)
        )
    )

    result = await db.execute(query)
    collection = result.scalar_one_or_none()

    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    if collection.collection_type != expected_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Collection type mismatch",
        )

    return collection


def _extract_stream_assets(stream: Stream) -> StreamAssetSelection:
    mix_mode = (stream.mix_mode or "video_only").lower()

    def build_payload(asset_obj: Asset, loop_mode: str = "loop") -> Dict[str, Any]:
        return {
            "path": asset_obj.storage_path,
            "meta": asset_obj.meta or {},
            "asset_id": str(asset_obj.id),
            "filename": asset_obj.filename,
            "compatible_for_copy": asset_obj.compatible_for_copy,
            "validation_errors": asset_obj.validation_errors or [],
            "loop_mode": loop_mode,
        }

    video_assets: List[Dict[str, Any]] = []
    audio_assets: List[Dict[str, Any]] = []

    allow_video_placeholder = mix_mode == "mixed"

    if stream.video_collection:
        items = sorted(stream.video_collection.items or [], key=lambda x: x.position)
        for item in items:
            if item.asset:
                loop_mode = (item.loop_mode or "loop") if hasattr(item, "loop_mode") else "loop"
                video_assets.append(build_payload(item.asset, loop_mode))
    elif stream.source_type == "playlist":
        if not stream.playlist:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Playlist is missing for this stream",
            )
        items = sorted(stream.playlist.items or [], key=lambda x: x.position)
        for item in items:
            if item.asset:
                video_assets.append(build_payload(item.asset, "loop"))
    else:
        links = sorted(stream.stream_assets or [], key=lambda x: x.position)
        for link in links:
            if link.asset:
                video_assets.append(build_payload(link.asset, "loop"))

    if not video_assets and not allow_video_placeholder:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one video asset is required for this stream",
        )
    if not video_assets and allow_video_placeholder:
        logger.info("Stream %s mixed mode without video assets; using placeholder background", stream.id)

    if stream.audio_collection and mix_mode in {"audio_only", "mixed"}:
        items = sorted(stream.audio_collection.items or [], key=lambda x: x.position)
        if not items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Audio collection has no assets",
            )
        for item in items:
            if item.asset:
                loop_mode = (item.loop_mode or "loop") if hasattr(item, "loop_mode") else "loop"
                audio_assets.append(build_payload(item.asset, loop_mode))
    elif mix_mode == "mixed":
        # Mixed mode without audio collection is invalid
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mixed streams require an audio collection",
        )

    return StreamAssetSelection(
        video_assets=video_assets,
        audio_assets=audio_assets,
        mix_mode=mix_mode,
    )


def _gather_stream_destinations(stream: Stream) -> List[Dict[str, str]]:
    destinations: List[Dict[str, str]] = []
    for stream_dest in stream.stream_destinations:
        dest = stream_dest.destination
        if not dest or not dest.enabled:
            continue

        decrypted_key = decrypt_stream_key(dest.stream_key_encrypted)
        normalized_url = (dest.rtmps_url or "").strip().rstrip("/")
        if not normalized_url:
            logger.warning(
                "Destination %s for stream %s has no RTMP(S) URL, skipping",
                dest.id,
                stream.id,
            )
            continue

        destinations.append(
            {
                "url": normalized_url,
                "key": decrypted_key,
            }
        )

    return destinations


async def _prepare_stream_launch(
    db: AsyncSession,
    user_id: UUID,
    stream: Stream,
    *,
    enforcer: Optional[QuotaEnforcer] = None,
) -> Tuple[PlaylistFileSet, List[Dict[str, str]], Path]:
    """
    Validate assets, build playlists, and collect destinations for a stream.
    """
    selection = _extract_stream_assets(stream)
    quota = enforcer or QuotaEnforcer(db, user_id)
    quality = await quota.evaluate_stream_quality(selection.video_assets)
    if not quality["ok"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "quality_rejected",
                **quality,
            },
        )

    compatibility_issues: List[Dict[str, Any]] = []
    video_ok = True
    audio_ok = True

    if selection.video_assets:
        video_ok, video_issues = PlaylistBuilder.validate_playlist_assets(selection.video_assets)
        if not video_ok:
            compatibility_issues.extend(video_issues)

    if selection.mix_mode in {"audio_only", "mixed"}:
        audio_ok, audio_issues = PlaylistBuilder.validate_audio_playlist_assets(selection.audio_assets)
        if not audio_ok:
            compatibility_issues.extend(audio_issues)

    if not video_ok or not audio_ok:
        logger.warning("Stream %s failed validation: %s", stream.id, compatibility_issues)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "Playlist assets are incompatible",
                "issues": compatibility_issues,
            },
        )

    builder = PlaylistBuilder()
    stream_dir = Path(settings.stream_dir) / str(stream.id)
    stream_dir.mkdir(parents=True, exist_ok=True)

    log_file = Path(stream.log_path) if stream.log_path else stream_dir / "stream.log"
    playlists = builder.prepare_stream_playlists(
        stream_id=str(stream.id),
        stream_dir=stream_dir,
        video_assets=selection.video_assets,
        audio_assets=selection.audio_assets,
        mix_mode=selection.mix_mode,
    )

    destinations = _gather_stream_destinations(stream)
    if not destinations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No enabled destinations found",
        )

    return playlists, destinations, log_file


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
                selectinload(Stream.video_collection)
                .selectinload(MediaCollection.items)
                .selectinload(CollectionItem.asset),
                selectinload(Stream.audio_collection)
                .selectinload(MediaCollection.items)
                .selectinload(CollectionItem.asset),
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
        video_collection = None
        audio_collection = None

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
        if stream_data.video_collection_id:
            video_collection = await _get_collection_for_user(
                db,
                user_id,
                stream_data.video_collection_id,
                expected_type="video_background",
            )
            if not video_collection.items:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Video collection is empty",
                )

        if stream_data.audio_collection_id:
            audio_collection = await _get_collection_for_user(
                db,
                user_id,
                stream_data.audio_collection_id,
                expected_type="audio_playlist",
            )
            if not audio_collection.items:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Audio collection is empty",
                )

        if playlist and (video_collection or audio_collection):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Choose playlist/assets or collections, not both",
            )

        if (video_collection or audio_collection) and stream_data.asset_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Asset IDs are not allowed when using collections",
            )

        if not playlist and not video_collection and not audio_collection:
            asset_ids = stream_data.asset_ids or []
            if not asset_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="At least one asset must be selected",
                )

            assets_query = select(Asset).where(
                Asset.user_id == user_id,
                Asset.id.in_(asset_ids),
            )
            result = await db.execute(assets_query)
            fetched_assets = result.scalars().all()

            if len(fetched_assets) != len(set(asset_ids)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="One or more assets were not found",
                )

            asset_lookup = {str(asset.id): asset for asset in fetched_assets}
            try:
                selected_assets = [asset_lookup[str(asset_id)] for asset_id in asset_ids]
            except KeyError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Asset selection contains duplicates or invalid IDs",
                ) from exc

        mix_mode = stream_data.mix_mode
        if mix_mode is None:
            if video_collection and audio_collection:
                mix_mode = "mixed"
            elif video_collection:
                mix_mode = "video_only"
            elif audio_collection:
                mix_mode = "audio_only"
            else:
                mix_mode = "video_only"

        if mix_mode not in ALLOWED_MIX_MODES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid mix mode",
            )

        if mix_mode in {"video_only", "mixed"} and not (playlist or selected_assets or video_collection):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Video source is required for selected mix mode",
            )

        if mix_mode in {"audio_only", "mixed"} and not audio_collection:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Audio collection required for selected mix mode",
            )

        settings_json = stream_data.settings_json or {}
        if not isinstance(settings_json, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="settings_json must be an object",
            )

        source_type = "playlist" if playlist else "assets"

        stream = Stream(
            user_id=user_id,
            playlist_id=playlist.id if playlist else None,
            video_collection_id=video_collection.id if video_collection else None,
            audio_collection_id=audio_collection.id if audio_collection else None,
            mix_mode=mix_mode,
            settings_json=settings_json,
            source_type=source_type,
            name=stream_data.name,
            status="stopped"
        )

        db.add(stream)
        await db.flush()

        if selected_assets:
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

    selection = _extract_stream_assets(stream)

    enforcer = QuotaEnforcer(db, user_id)
    quality = await enforcer.evaluate_stream_quality(selection.video_assets)

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
        
        playlists, destinations, log_file = await _prepare_stream_launch(
            db,
            user_id,
            stream,
            enforcer=enforcer,
        )
        
        # Start FFmpeg process
        success = await ffmpeg_manager.start_stream(
            str(stream_id),
            playlists,
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
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error starting stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start stream: {str(e)}"
        )

@router.patch("/{stream_id}/live-config", response_model=StreamResponse)
async def live_update_stream(
    stream_id: UUID,
    update: StreamLiveUpdateRequest,
    user_deps: tuple = Depends(require_user),
):
    """
    Reorder or replace collection items for an active stream and optionally trigger a hot restart.
    """
    db, user_id = user_deps

    stream = await _load_stream_with_relations(db, user_id, stream_id)
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream not found",
        )

    target_collection = (
        stream.video_collection if update.target == "video" else stream.audio_collection
    )
    if not target_collection:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stream does not have the requested collection",
        )

    normalized_items = normalize_collection_items(update.items)
    expected_type = "video" if update.target == "video" else "audio"
    await validate_collection_assets(db, user_id, normalized_items, expected_type)

    try:
        await replace_collection_items(db, target_collection, normalized_items)
        await db.flush()

        stream = await _load_stream_with_relations(db, user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found after update",
            )

        playlists, destinations, log_file = await _prepare_stream_launch(db, user_id, stream)

        should_restart = update.restart and stream.status == "running"
        if should_restart:
            restart_ok = await ffmpeg_manager.restart_stream(
                str(stream_id),
                playlists,
                destinations=destinations,
                log_file=log_file,
                metadata={
                    "user_id": user_id,
                    "stream_id": str(stream.id),
                    "live_edit_target": update.target,
                },
            )
            if not restart_ok:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to restart stream",
                )

        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:  # pylint: disable=broad-except
        await db.rollback()
        logger.exception("Live update failed for stream %s: %s", stream_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update stream configuration",
        ) from exc

    updated_stream = await _load_stream_with_relations(db, user_id, stream_id)
    if not updated_stream:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream not found after restart",
        )

    return updated_stream


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
        await ffmpeg_manager.stop_stream(str(stream_id))
        
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
