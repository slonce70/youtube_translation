"""Utilities shared by stream services."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings as default_settings
from app.core.security import decrypt_stream_key
from app.models.database import (
    Asset,
    CollectionItem,
    Destination,
    MediaCollection,
    Playlist,
    PlaylistItem,
    Stream,
    StreamAsset,
    StreamDestination,
)
from app.streaming.playlist_builder import PlaylistBuilder, PlaylistFileSet

ALLOWED_MIX_MODES = {"video_only", "audio_only", "mixed"}

logger = logging.getLogger(__name__)


def build_asset_payload(asset_obj: Asset, loop_mode: str = "loop") -> Dict[str, Any]:
    meta = asset_obj.meta or {}
    duration = meta.get("duration")
    if duration is None:
        video_meta = meta.get("video") if isinstance(meta, dict) else None
        if isinstance(video_meta, dict):
            duration = video_meta.get("duration")

    # Verify that storage_path points to an existing file
    storage_path = Path(asset_obj.storage_path)
    if not storage_path.exists():
        logger.error(
            "Asset %s (%s) has invalid storage_path: %s (file not found)",
            asset_obj.id,
            asset_obj.filename,
            storage_path,
        )
        resolved_path = storage_path
    else:
        resolved_path = storage_path.resolve()

    payload = {
        "path": str(resolved_path),
        "meta": meta,
        "asset_id": str(asset_obj.id),
        "filename": asset_obj.filename,
        "compatible_for_copy": asset_obj.compatible_for_copy,
        "validation_errors": asset_obj.validation_errors or [],
        "loop_mode": loop_mode,
    }
    if duration is not None:
        payload.setdefault("meta", {}).setdefault("duration", duration)
    return payload


@dataclass
class StreamAssetSelection:
    video_assets: List[Dict[str, Any]]
    audio_assets: List[Dict[str, Any]]
    mix_mode: str

    def all_assets(self) -> List[Dict[str, Any]]:
        return list(self.video_assets) + list(self.audio_assets)


async def load_stream_with_relations(
    db: AsyncSession, user_id: UUID, stream_id: UUID
) -> Stream:
    query = (
        select(Stream)
        .where(Stream.id == stream_id, Stream.user_id == user_id)
        .options(
            selectinload(Stream.playlist)
            .selectinload(Playlist.items)
            .selectinload(PlaylistItem.asset),
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


async def get_collection_for_user(
    db: AsyncSession,
    user_id: UUID,
    collection_id: UUID,
    expected_type: str,
) -> MediaCollection:
    query = (
        select(MediaCollection)
        .where(MediaCollection.id == collection_id, MediaCollection.user_id == user_id)
        .options(selectinload(MediaCollection.items).selectinload(CollectionItem.asset))
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


def extract_stream_assets(stream: Stream) -> StreamAssetSelection:
    mix_mode = (stream.mix_mode or "video_only").lower()

    def build_payload(asset_obj: Asset, loop_mode: str = "loop") -> Dict[str, Any]:
        return build_asset_payload(asset_obj, loop_mode)

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
        logger.info(
            "Stream %s mixed mode without video assets; using placeholder background",
            stream.id,
        )

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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mixed streams require an audio collection",
        )

    return StreamAssetSelection(video_assets=video_assets, audio_assets=audio_assets, mix_mode=mix_mode)


def gather_stream_destinations(stream: Stream) -> List[Dict[str, str]]:
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

        destinations.append({"url": normalized_url, "key": decrypted_key})

    return destinations


async def prepare_stream_launch(
    db: AsyncSession,
    user_id: UUID,
    stream: Stream,
    *,
    quota_evaluator,
    settings_obj=default_settings,
) -> Tuple[PlaylistFileSet, List[Dict[str, str]], Path]:
    selection, destinations, log_file = await validate_stream_launch_prerequisites(
        db,
        user_id,
        stream,
        quota_evaluator=quota_evaluator,
        settings_obj=settings_obj,
    )

    builder = PlaylistBuilder()
    stream_dir = Path(settings_obj.stream_dir) / str(stream.id)
    playlists = builder.prepare_stream_playlists(
        stream_id=str(stream.id),
        stream_dir=stream_dir,
        video_assets=selection.video_assets,
        audio_assets=selection.audio_assets,
        mix_mode=selection.mix_mode,
    )

    return playlists, destinations, log_file


async def validate_stream_launch_prerequisites(
    db: AsyncSession,
    user_id: UUID,
    stream: Stream,
    *,
    quota_evaluator,
    settings_obj=default_settings,
) -> Tuple[StreamAssetSelection, List[Dict[str, str]], Path]:
    selection = extract_stream_assets(stream)
    quality = await quota_evaluator.evaluate_stream_quality(
        selection.video_assets,
        audio_assets=selection.audio_assets,
        mix_mode=selection.mix_mode,
    )
    if not quality["ok"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "quality_rejected", **quality},
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Playlist assets are incompatible", "issues": compatibility_issues},
        )

    stream_dir = Path(settings_obj.stream_dir) / str(stream.id)
    stream_dir.mkdir(parents=True, exist_ok=True)

    log_file = Path(stream.log_path) if stream.log_path else stream_dir / "stream.log"
    destinations = gather_stream_destinations(stream)
    if not destinations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No enabled destinations found",
        )

    return selection, destinations, log_file


async def fetch_destinations(db: AsyncSession, user_id: UUID, destination_ids: List[UUID]) -> List[Destination]:
    if not destination_ids:
        return []

    fetched: List[Destination] = []
    for dest_id in destination_ids:
        dest_query = select(Destination).where(Destination.id == dest_id, Destination.user_id == user_id)
        dest_result = await db.execute(dest_query)
        destination = dest_result.scalar_one_or_none()
        if not destination:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Destination {dest_id} not found",
            )
        fetched.append(destination)
    return fetched


__all__ = [
    "ALLOWED_MIX_MODES",
    "StreamAssetSelection",
    "load_stream_with_relations",
    "get_collection_for_user",
    "extract_stream_assets",
    "gather_stream_destinations",
    "prepare_stream_launch",
    "validate_stream_launch_prerequisites",
    "fetch_destinations",
    "build_asset_payload",
]
