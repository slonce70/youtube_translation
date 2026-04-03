"""Serialization helpers for asset responses."""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    Asset,
    AssetFolderLink,
    CollectionItem,
    MediaCollection,
    MediaFolder,
    Playlist,
    PlaylistItem,
    Stream,
    StreamAsset,
)
from app.schemas.api import (
    AssetFolderInfo,
    AssetOptimizationInfo,
    AssetResponse,
    AssetUsageReference,
    AssetUsageSummary,
)

from .storage import get_asset_storage_backend, get_asset_storage_key


async def collect_asset_folders(
    db: AsyncSession, asset_ids: Sequence[UUID]
) -> Tuple[Dict[UUID, List[AssetFolderInfo]], Dict[UUID, Optional[UUID]]]:
    if not asset_ids:
        return {}, {}

    rows = await db.execute(
        select(
            AssetFolderLink.asset_id,
            AssetFolderLink.folder_id,
            MediaFolder.name,
            MediaFolder.is_root,
        )
        .join(MediaFolder, MediaFolder.id == AssetFolderLink.folder_id)
        .where(AssetFolderLink.asset_id.in_(asset_ids))
        .order_by(MediaFolder.is_root.desc(), MediaFolder.created_at)
    )

    folder_map: Dict[UUID, List[AssetFolderInfo]] = defaultdict(list)
    primary_map: Dict[UUID, Optional[UUID]] = {}

    for asset_id, folder_id, folder_name, is_root in rows:
        info = AssetFolderInfo(folder_id=folder_id, name=folder_name, is_root=is_root)
        folder_map[asset_id].append(info)

    for asset_id, folders in folder_map.items():
        primary = next(
            (folder.folder_id for folder in folders if not folder.is_root), None
        )
        if primary is None and folders:
            primary = folders[0].folder_id
        primary_map[asset_id] = primary

    return folder_map, primary_map


async def collect_asset_usage(
    db: AsyncSession,
    user_id: UUID,
    asset_ids: Sequence[UUID],
) -> Tuple[
    Dict[UUID, List[AssetUsageReference]],
    Dict[UUID, List[AssetUsageReference]],
    Dict[UUID, List[AssetUsageReference]],
]:
    if not asset_ids:
        return {}, {}, {}

    playlist_usage: Dict[UUID, List[AssetUsageReference]] = defaultdict(list)
    collection_usage: Dict[UUID, List[AssetUsageReference]] = defaultdict(list)
    stream_usage: Dict[UUID, List[AssetUsageReference]] = defaultdict(list)

    playlist_rows = await db.execute(
        select(PlaylistItem.asset_id, Playlist.id, Playlist.name)
        .join(Playlist, Playlist.id == PlaylistItem.playlist_id)
        .where(
            Playlist.user_id == user_id,
            PlaylistItem.asset_id.in_(asset_ids),
        )
    )
    for asset_id, playlist_id, playlist_name in playlist_rows:
        playlist_usage[asset_id].append(
            AssetUsageReference(
                id=playlist_id,
                name=playlist_name or "Untitled playlist",
                kind="playlist",
            )
        )

    collection_rows = await db.execute(
        select(
            CollectionItem.asset_id,
            MediaCollection.id,
            MediaCollection.name,
            MediaCollection.collection_type,
        )
        .join(MediaCollection, MediaCollection.id == CollectionItem.collection_id)
        .where(
            MediaCollection.user_id == user_id,
            CollectionItem.asset_id.in_(asset_ids),
        )
    )

    collection_to_assets: Dict[UUID, set[UUID]] = defaultdict(set)
    for asset_id, collection_id, collection_name, collection_type in collection_rows:
        collection_usage[asset_id].append(
            AssetUsageReference(
                id=collection_id,
                name=collection_name or "Untitled collection",
                kind="collection",
                context=collection_type,
            )
        )
        collection_to_assets[collection_id].add(asset_id)

    stream_asset_rows = await db.execute(
        select(StreamAsset.asset_id, Stream.id, Stream.name, Stream.status)
        .join(Stream, Stream.id == StreamAsset.stream_id)
        .where(
            Stream.user_id == user_id,
            StreamAsset.asset_id.in_(asset_ids),
        )
    )

    seen_stream_pairs: set[Tuple[UUID, UUID]] = set()
    for asset_id, stream_id, stream_name, stream_status in stream_asset_rows:
        pair = (asset_id, stream_id)
        if pair in seen_stream_pairs:
            continue
        seen_stream_pairs.add(pair)
        stream_usage[asset_id].append(
            AssetUsageReference(
                id=stream_id,
                name=stream_name or "Untitled stream",
                kind="stream",
                status=stream_status,
            )
        )

    if collection_to_assets:
        collection_ids = list(collection_to_assets.keys())
        stream_via_collection_rows = await db.execute(
            select(
                Stream.id,
                Stream.name,
                Stream.status,
                Stream.video_collection_id,
                Stream.audio_collection_id,
            )
            .where(Stream.user_id == user_id)
            .where(
                or_(
                    Stream.video_collection_id.in_(collection_ids),
                    Stream.audio_collection_id.in_(collection_ids),
                )
            )
        )

        for (
            stream_id,
            stream_name,
            stream_status,
            video_collection_id,
            audio_collection_id,
        ) in stream_via_collection_rows:
            linked_collections = [
                cid for cid in [video_collection_id, audio_collection_id] if cid
            ]
            for collection_id in linked_collections:
                for asset_id in collection_to_assets.get(collection_id, []):
                    pair = (asset_id, stream_id)
                    if pair in seen_stream_pairs:
                        continue
                    seen_stream_pairs.add(pair)
                    stream_usage[asset_id].append(
                        AssetUsageReference(
                            id=stream_id,
                            name=stream_name or "Untitled stream",
                            kind="stream",
                            status=stream_status,
                        )
                    )

    return playlist_usage, collection_usage, stream_usage


def extract_thumbnail_url(asset: Asset) -> Optional[str]:
    meta = asset.meta if isinstance(asset.meta, dict) else None
    if meta and isinstance(meta.get("thumbnail_url"), str):
        return meta["thumbnail_url"]
    return None


def build_asset_optimization_info(asset: Asset) -> AssetOptimizationInfo:
    recommended_strategy = "copy" if asset.compatible_for_copy else "transcode"
    raw_status = (
        str(getattr(asset, "optimization_status", "") or "not_requested")
        .strip()
        .lower()
    )
    status = (
        raw_status
        if raw_status in {"not_requested", "queued", "processing", "ready", "failed"}
        else "not_requested"
    )
    raw_strategy = getattr(asset, "optimization_strategy", None)
    strategy = str(raw_strategy).strip().lower() if raw_strategy else None
    if strategy not in {"copy", "transcode"}:
        strategy = None

    optimized_storage_path = getattr(asset, "optimized_storage_path", None)
    if status == "ready" and strategy == "copy" and not optimized_storage_path:
        optimized_storage_path = asset.storage_path

    return AssetOptimizationInfo(
        status=status,
        strategy=strategy,
        optimized_storage_path=optimized_storage_path,
        error=getattr(asset, "optimization_error", None),
        updated_at=getattr(asset, "optimization_updated_at", None),
        recommended_strategy=recommended_strategy,
        can_stream_from_source=bool(asset.compatible_for_copy),
    )


def serialize_loaded_asset(asset: Asset) -> AssetResponse:
    """Serialize an already-loaded asset without additional DB lookups."""

    return AssetResponse(
        id=asset.id,
        user_id=asset.user_id,
        filename=asset.filename,
        storage_path=asset.storage_path,
        storage_backend=get_asset_storage_backend(asset),
        storage_key=get_asset_storage_key(asset),
        size_bytes=asset.size_bytes,
        duration_seconds=asset.duration_seconds,
        meta=asset.meta,
        asset_type=asset.asset_type,
        codec_info=asset.codec_info,
        compatible_for_copy=asset.compatible_for_copy,
        validation_errors=asset.validation_errors,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
        primary_folder_id=None,
        folders=[],
        usage=AssetUsageSummary(),
        thumbnail_url=extract_thumbnail_url(asset),
        optimization=build_asset_optimization_info(asset),
    )


async def serialize_assets(
    db: AsyncSession, user_id: UUID, assets: Sequence[Asset]
) -> List[AssetResponse]:
    if not assets:
        return []

    asset_ids = [asset.id for asset in assets]
    folder_map, primary_map = await collect_asset_folders(db, asset_ids)
    playlist_usage, collection_usage, stream_usage = await collect_asset_usage(
        db, user_id, asset_ids
    )

    responses: List[AssetResponse] = []
    for asset in assets:
        usage_summary = AssetUsageSummary(
            playlists=playlist_usage.get(asset.id, []),
            collections=collection_usage.get(asset.id, []),
            streams=stream_usage.get(asset.id, []),
        )

        serialized = serialize_loaded_asset(asset)
        serialized.primary_folder_id = primary_map.get(asset.id)
        serialized.folders = folder_map.get(asset.id, [])
        serialized.usage = usage_summary
        responses.append(serialized)

    return responses
