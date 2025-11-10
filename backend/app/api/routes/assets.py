from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, func, text, or_
from typing import List, Tuple, Dict, Any, Optional, Sequence
from collections import defaultdict
from pathlib import Path
import asyncio
import json
from uuid import UUID
import logging
import base64
import hashlib
import hmac
import time
from datetime import datetime, timezone

from fastapi.responses import FileResponse

from app.api.deps import require_user
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
    SystemAlert,
    UserActivityLog,
    UserProfile,
)
from app.schemas.api import (
    AssetResponse,
    AssetCreate,
    AssetUpdate,
    AssetDownloadLinkResponse,
    AssetFolderInfo,
    AssetUsageReference,
    AssetUsageSummary,
    ALLOWED_ASSET_TYPES,
)
from app.streaming.validator import VideoValidator
from app.core.config import settings
from app.core.database import get_db
from app.core.quota import QuotaEnforcer

logger = logging.getLogger(__name__)
router = APIRouter()

# Initialize validator
try:
    validator = VideoValidator(settings.ffprobe_bin)
except FileNotFoundError as exc:
    logger.error("FFprobe binary not available: %s", exc)
    validator = None


def infer_asset_type(stream_meta: Optional[Dict[str, Any]], fallback: str = "video") -> str:
    if not isinstance(stream_meta, dict):
        return fallback

    video_meta = stream_meta.get("video") if isinstance(stream_meta, dict) else None
    audio_meta = stream_meta.get("audio") if isinstance(stream_meta, dict) else None

    if video_meta and video_meta.get("codec"):
        return "video"
    if audio_meta and not video_meta:
        return "audio"
    return fallback


def normalize_asset_type(
    requested: Optional[str], stream_meta: Optional[Dict[str, Any]]
) -> str:
    candidate = (requested or "video").lower()
    if candidate not in ALLOWED_ASSET_TYPES:
        candidate = "video"
    return infer_asset_type(stream_meta, candidate)


async def _apply_storage_delta(
    db: AsyncSession,
    user_id: UUID,
    delta_bytes: int,
) -> None:
    if not delta_bytes:
        return

    await db.execute(
        update(UserProfile)
        .where(UserProfile.user_id == user_id)
        .values(
            current_storage_bytes=func.GREATEST(
                func.coalesce(UserProfile.current_storage_bytes, 0) + delta_bytes,
                0,
            )
        )
    )


async def _audit_collection_quorum(
    db: AsyncSession,
    collection_ids: List[UUID],
    asset_id: Optional[UUID] = None,
) -> None:
    if not collection_ids:
        return

    unique_ids = list({cid for cid in collection_ids if cid is not None})
    if not unique_ids:
        return

    result = await db.execute(
        select(
            MediaCollection.id,
            MediaCollection.user_id,
            MediaCollection.name,
            MediaCollection.collection_type,
            func.count(CollectionItem.id).label("items"),
        )
        .outerjoin(CollectionItem, CollectionItem.collection_id == MediaCollection.id)
        .where(MediaCollection.id.in_(unique_ids))
        .group_by(
            MediaCollection.id,
            MediaCollection.user_id,
            MediaCollection.name,
            MediaCollection.collection_type,
        )
    )

    depleted: List[MediaCollection] = []
    for row in result.all():
        if row.items == 0:
            collection = await db.get(MediaCollection, row.id)
            if collection and collection.is_active:
                collection.is_active = False
                depleted.append(collection)

    for collection in depleted:
        alert = SystemAlert(
            user_id=collection.user_id,
            alert_type="collection_depleted",
            severity="warning",
            asset_id=None,
            message=f"Collection '{collection.name}' no longer contains assets",
            details={
                "collection_id": str(collection.id),
                "collection_type": collection.collection_type,
            },
        )
        db.add(alert)


def apply_stream_summary_fields(asset: Asset, stream_meta: Optional[Dict[str, Any]]) -> None:
    """Populate summary columns (codec, bitrate, resolution) from ffprobe meta."""
    if not stream_meta:
        return

    video_meta = stream_meta.get("video") if isinstance(stream_meta, dict) else None
    audio_meta = stream_meta.get("audio") if isinstance(stream_meta, dict) else None

    try:
        resolution_width = int(video_meta.get("width")) if video_meta and video_meta.get("width") else None
        resolution_height = int(video_meta.get("height")) if video_meta and video_meta.get("height") else None
    except (TypeError, ValueError):
        resolution_width = resolution_height = None

    if video_meta and video_meta.get("codec"):
        asset.video_codec = str(video_meta.get("codec"))

    if audio_meta and audio_meta.get("codec"):
        asset.audio_codec = str(audio_meta.get("codec"))

    if resolution_width and resolution_height:
        asset.resolution = f"{resolution_width}x{resolution_height}"

    bitrate_source = None
    if isinstance(stream_meta, dict):
        bitrate_source = stream_meta.get("bitrate")

    if not bitrate_source and video_meta:
        bitrate_source = video_meta.get("bitrate")
    if not bitrate_source and audio_meta:
        bitrate_source = audio_meta.get("bitrate")

    try:
        if bitrate_source:
            asset.bitrate = int(bitrate_source)
    except (TypeError, ValueError):
        pass

    fps_value = None
    if video_meta and video_meta.get("fps"):
        try:
            fps_value = float(video_meta.get("fps"))
        except (TypeError, ValueError):
            fps_value = None

    if fps_value is not None:
        asset.fps = int(round(fps_value))

    asset.asset_type = infer_asset_type(stream_meta, asset.asset_type or "video")


def _sign_download_payload(payload: str) -> str:
    signature = hmac.new(
        settings.download_token_secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return signature


def generate_download_token(asset_id: UUID, user_id: UUID) -> Tuple[str, int]:
    expires_at = int(time.time()) + settings.download_token_ttl_seconds
    payload = f"{asset_id}:{user_id}:{expires_at}"
    signature = _sign_download_payload(payload)
    token_bytes = f"{payload}:{signature}".encode("utf-8")
    token = base64.urlsafe_b64encode(token_bytes).decode("utf-8")
    return token, expires_at


def parse_download_token(token: str) -> Tuple[UUID, UUID, int]:
    try:
        decoded = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
        parts = decoded.split(":")
        if len(parts) != 4:
            raise ValueError("invalid token format")
        asset_id_str, user_id_str, expires_at_str, signature = parts
        payload = ":".join(parts[:3])
        expected_signature = _sign_download_payload(payload)
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("invalid signature")
        expires_at = int(expires_at_str)
        if expires_at < int(time.time()):
            raise ValueError("token expired")
        return UUID(asset_id_str), UUID(user_id_str), expires_at
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired download token",
        ) from exc


def _extract_thumbnail_url(asset: Asset) -> Optional[str]:
    meta = asset.meta if isinstance(asset.meta, dict) else None
    if not meta:
        return None

    thumbnail_candidates = [
        meta.get("thumbnail_url"),
        meta.get("poster_url"),
        meta.get("preview_url"),
    ]

    for candidate in thumbnail_candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate

    thumbnails = meta.get("thumbnails")
    if isinstance(thumbnails, list):
        for entry in thumbnails:
            if isinstance(entry, dict):
                url = entry.get("url") or entry.get("path")
                if isinstance(url, str) and url.strip():
                    return url

    preview = meta.get("preview")
    if isinstance(preview, dict):
        url = preview.get("url") or preview.get("path")
        if isinstance(url, str) and url.strip():
            return url

    return None


async def _collect_asset_folders(
    db: AsyncSession,
    asset_ids: Sequence[UUID],
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
        primary = next((folder.folder_id for folder in folders if not folder.is_root), None)
        if primary is None and folders:
            primary = folders[0].folder_id
        primary_map[asset_id] = primary

    return folder_map, primary_map


async def _collect_asset_usage(
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
            for related_collection in (video_collection_id, audio_collection_id):
                if related_collection and related_collection in collection_to_assets:
                    for asset_id in collection_to_assets[related_collection]:
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
                                context="collection",
                            )
                        )

    return playlist_usage, collection_usage, stream_usage


async def _serialize_assets(
    db: AsyncSession,
    user_id: UUID,
    assets: Sequence[Asset],
) -> List[AssetResponse]:
    if not assets:
        return []

    asset_ids = [asset.id for asset in assets]
    folder_map, primary_map = await _collect_asset_folders(db, asset_ids)
    playlist_usage, collection_usage, stream_usage = await _collect_asset_usage(db, user_id, asset_ids)

    responses: List[AssetResponse] = []
    for asset in assets:
        usage_summary = AssetUsageSummary(
            playlists=playlist_usage.get(asset.id, []),
            collections=collection_usage.get(asset.id, []),
            streams=stream_usage.get(asset.id, []),
        )

        responses.append(
            AssetResponse(
                id=asset.id,
                user_id=asset.user_id,
                filename=asset.filename,
                storage_path=asset.storage_path,
                size_bytes=asset.size_bytes,
                duration_seconds=asset.duration_seconds,
                meta=asset.meta,
                asset_type=asset.asset_type,
                codec_info=asset.codec_info,
                compatible_for_copy=asset.compatible_for_copy,
                validation_errors=asset.validation_errors,
                created_at=asset.created_at,
                updated_at=asset.updated_at,
                primary_folder_id=primary_map.get(asset.id),
                folders=folder_map.get(asset.id, []),
                usage=usage_summary,
                thumbnail_url=_extract_thumbnail_url(asset),
            )
        )

    return responses

@router.get("/", response_model=List[AssetResponse])
async def list_assets(
    asset_type: Optional[str] = Query(
        None, description="Filter by asset type: video | audio"
    ),
    folder_id: Optional[UUID] = Query(
        None, description="Filter by folder ID and descendants"
    ),
    user_deps: tuple = Depends(require_user)
):
    """List assets for current user with optional filters"""
    db, user_id = user_deps

    try:
        # Build query - filter by user_id directly
        query = select(Asset).where(Asset.user_id == user_id)

        normalized_asset_type: Optional[str]
        if asset_type is None:
            normalized_asset_type = None
        elif isinstance(asset_type, str):
            normalized_asset_type = asset_type.strip().lower()
        else:
            default_value = getattr(asset_type, "default", None)
            normalized_asset_type = default_value.strip().lower() if isinstance(default_value, str) else None

        if normalized_asset_type:
            if normalized_asset_type not in ALLOWED_ASSET_TYPES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="asset_type must be 'video' or 'audio'",
                )
            query = query.where(Asset.asset_type == normalized_asset_type)

        resolved_folder_id: Optional[UUID]
        if folder_id is None:
            resolved_folder_id = None
        elif isinstance(folder_id, UUID):
            resolved_folder_id = folder_id
        else:
            default_folder = getattr(folder_id, "default", None)
            resolved_folder_id = default_folder if isinstance(default_folder, UUID) else None

        if resolved_folder_id:
            subfolders = await db.execute(
                select(MediaFolder.id)
                .where(MediaFolder.user_id == user_id)
            )
            all_folders = {row[0] for row in subfolders}
            if resolved_folder_id not in all_folders:
                logger.info(
                    "Requested folder %s not found for user %s; returning empty asset list",
                    resolved_folder_id,
                    user_id,
                )
                return []
            recursive = text(
                """
                WITH RECURSIVE folder_tree AS (
                    SELECT id FROM media_folders WHERE id = :folder_id
                    UNION ALL
                    SELECT mf.id
                    FROM media_folders mf
                    JOIN folder_tree ft ON mf.parent_id = ft.id
                    WHERE mf.user_id = :user_id
                )
                SELECT asset_id FROM asset_folder_links WHERE folder_id IN (SELECT id FROM folder_tree)
                """
            )
            result = await db.execute(recursive, {"folder_id": str(resolved_folder_id), "user_id": str(user_id)})
            asset_ids = [row[0] for row in result]
            if not asset_ids:
                return []
            query = query.where(Asset.id.in_(asset_ids))

        query = query.order_by(Asset.created_at.desc())
        result = await db.execute(query)
        assets = result.scalars().unique().all()

        return await _serialize_assets(db, user_id, assets)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error listing assets: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list assets: {str(e)}"
        )


@router.post("/", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
async def create_asset(
    asset_data: AssetCreate,
    background_tasks: BackgroundTasks,
    user_deps: tuple = Depends(require_user)
):
    """
    Create asset record after file upload.
    Called by tusd webhook or after manual upload.
    """
    db, user_id = user_deps
    
    try:
        # Check quota for assets
        enforcer = QuotaEnforcer(db, user_id)
        await enforcer.check_assets_limit()
        await enforcer.check_storage_limit(asset_data.size_bytes)
        
        # Create asset record - directly for user_id
        stream_meta = asset_data.meta if isinstance(asset_data.meta, dict) else {}
        asset = Asset(
            user_id=user_id,
            filename=asset_data.filename,
            storage_path=asset_data.storage_path,
            size_bytes=asset_data.size_bytes,
            duration_seconds=asset_data.duration_seconds,
            meta=asset_data.meta,
            compatible_for_copy=asset_data.compatible_for_copy,
            validation_errors=asset_data.validation_errors,
            asset_type=asset_data.asset_type,
            codec_info=asset_data.codec_info or stream_meta,
        )

        if isinstance(stream_meta, dict):
            apply_stream_summary_fields(asset, stream_meta)
        asset.asset_type = normalize_asset_type(asset.asset_type, stream_meta)

        db.add(asset)
        await _apply_storage_delta(db, user_id, asset.size_bytes or 0)
        await db.commit()
        await db.refresh(asset)

        logger.info("Created asset %s for user %s", asset.id, user_id)

        serialized = await _serialize_assets(db, user_id, [asset])
        return serialized[0]
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error creating asset: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create asset: {str(e)}"
        )


@router.patch("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: UUID,
    asset_update: AssetUpdate,
    user_deps: tuple = Depends(require_user)
):
    """Update asset metadata (currently supports renaming)."""
    db, user_id = user_deps

    try:
        query = select(Asset).where(Asset.id == asset_id, Asset.user_id == user_id)
        result = await db.execute(query)
        asset = result.scalar_one_or_none()

        if asset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found",
            )

        updated = False

        if asset_update.filename is not None and asset_update.filename.strip():
            asset.filename = asset_update.filename.strip()
            updated = True

        if not updated:
            return asset

        await db.commit()
        await db.refresh(asset)
        logger.info("Updated asset %s metadata for user %s", asset.id, user_id)
        serialized = await _serialize_assets(db, user_id, [asset])
        return serialized[0]

    except HTTPException:
        raise
    except Exception as exc:  # pylint: disable=broad-except
        await db.rollback()
        logger.exception("Failed to update asset %s: %s", asset_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update asset",
        ) from exc


@router.post("/upload-complete")
async def handle_upload_complete(
    request: Request,
    background_tasks: BackgroundTasks = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Webhook handler called by tusd when upload completes.
    Validates the file and creates asset record.
    """
    try:
        try:
            upload_data = await request.json()
        except Exception as parse_error:
            raw_body = await request.body()
            logger.error(
                "Invalid webhook payload from tusd: %s (%s)", raw_body[:500], parse_error
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid tusd webhook payload",
            )

        event_block = upload_data.get("Event") or {}
        event_type = upload_data.get("Type") or event_block.get("Type")
        upload_meta = (
            upload_data.get("Upload")
            or event_block.get("Upload")
            or {}
        )
        upload_id = upload_meta.get("ID")

        if event_type and event_type != "post-finish":
            logger.debug(
                "Skipping tusd hook event '%s' for upload %s",
                event_type,
                upload_id,
            )
            return {"success": True, "skipped": True, "event": event_type}

        if not upload_meta:
            logger.warning("Missing upload metadata in tusd payload: %s", upload_data)
            return {"success": True, "skipped": True, "reason": "missing_upload"}

        storage_payload = (
            upload_data.get("Storage")
            or upload_meta.get("Storage")
            or event_block.get("Upload", {}).get("Storage")
            or {}
        )
        raw_path = storage_payload.get("Path")

        async def resolve_file_path() -> Path | None:
            def resolve_path(path_value: str | None) -> Path | None:
                if not path_value:
                    return None
                candidate = Path(path_value)
                return candidate if candidate.exists() else None

            file_candidate = resolve_path(raw_path)

            if not file_candidate or not file_candidate.is_file():
                info_path = resolve_path(storage_payload.get("InfoPath"))
                if info_path and info_path.is_file():
                    try:
                        info_data = json.loads(info_path.read_text(encoding="utf-8"))
                        raw_storage_path = (
                            info_data.get("Storage", {}).get("Path")
                            or info_data.get("storage", {}).get("path")
                        )
                        candidate = resolve_path(raw_storage_path)
                        if candidate and candidate.is_file():
                            file_candidate = candidate
                        elif info_data.get("ID"):
                            fallback = Path(settings.upload_dir) / info_data["ID"]
                            if fallback.exists():
                                file_candidate = fallback
                    except Exception as info_error:
                        logger.warning(
                            "Failed to parse tusd info file %s: %s",
                            info_path,
                            info_error,
                        )

            if (not file_candidate or not file_candidate.is_file()) and upload_id:
                fallback = Path(settings.upload_dir) / upload_id
                if fallback.exists():
                    file_candidate = fallback

            return file_candidate if file_candidate and file_candidate.is_file() else None

        file_path: Path | None = None
        for attempt in range(6):
            file_path = await resolve_file_path()
            if file_path:
                break
            await asyncio.sleep(0.5)

        if not file_path:
            logger.error(
                "Upload file not found after retries: id=%s storage=%s", upload_id, storage_payload
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Uploaded file not found on disk",
            )

        logger.info(f"Processing upload: {file_path}")

        upload_root = Path(settings.upload_dir).resolve()
        resolved_path = file_path.resolve()
        if upload_root not in resolved_path.parents and resolved_path != upload_root:
            logger.error(
                "Detected upload outside of permitted directory: %s (root=%s)",
                resolved_path,
                upload_root,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid upload path detected"
            )

        # Get file size early for fallbacks
        size_bytes = file_path.stat().st_size

        if validator is None:
            validation_result = {
                "compatible_for_copy": False,
                "meta": {},
                "validation_errors": [
                    "ffprobe is not available on the server. Install FFmpeg or set FFPROBE_BIN."
                ],
            }
            stream_info = {
                "duration": 0,
                "size_bytes": size_bytes,
                "bitrate": 0,
            }
        else:
            validation_result = await validator.validate_file(file_path)
            meta = validation_result.get("meta", {})
            stream_info = validator.get_stream_info(meta)

        meta = validation_result.get("meta", {})
        meta_payload = (
            upload_data.get("Meta")
            or upload_meta.get("MetaData")
            or event_block.get("Upload", {}).get("MetaData")
            or {}
        )

        if not meta_payload:
            info_path_value = storage_payload.get("InfoPath") if isinstance(storage_payload, dict) else None
            if info_path_value:
                info_file = Path(info_path_value)
                if info_file.exists():
                    try:
                        info_data = json.loads(info_file.read_text(encoding="utf-8"))
                        meta_payload = info_data.get("MetaData", {}) or {}
                    except Exception as info_error:
                        logger.warning(
                            "Unable to read metadata from %s: %s",
                            info_file,
                            info_error,
                        )

        created_asset = None

        project_id_raw = meta_payload.get("project_id")
        if project_id_raw:
            logger.info("Ignoring legacy project_id %s in tusd metadata", project_id_raw)

        filename_override = meta_payload.get("filename")
        user_id_raw = meta_payload.get("user_id")

        asset_owner_id = None
        if user_id_raw:
            try:
                asset_owner_id = UUID(user_id_raw)
            except ValueError:
                logger.warning("Invalid user_id provided in tusd metadata: %s", user_id_raw)
        else:
            logger.warning("Missing user_id in tusd metadata for upload %s", upload_id)

        if asset_owner_id:
            enforcer = QuotaEnforcer(db, asset_owner_id)
            await enforcer.check_assets_limit()
            await enforcer.check_storage_limit(size_bytes)

        if asset_owner_id:
            try:
                summary_meta = stream_info if isinstance(stream_info, dict) else {}
                resolved_asset_type = normalize_asset_type(None, summary_meta)
                asset = Asset(
                    user_id=asset_owner_id,
                    filename=filename_override or file_path.name,
                    storage_path=str(file_path),
                    size_bytes=size_bytes,
                    duration_seconds=stream_info.get("duration"),
                    meta=stream_info,
                    compatible_for_copy=validation_result["compatible_for_copy"],
                    validation_errors=validation_result.get("validation_errors", []),
                    asset_type=resolved_asset_type,
                    codec_info=validation_result.get("meta"),
                )

                apply_stream_summary_fields(asset, summary_meta)

                db.add(asset)
                await _apply_storage_delta(db, asset_owner_id, size_bytes)
                await db.commit()
                await db.refresh(asset)
                created_asset = asset
                logger.info(f"Created asset {asset.id} from tusd webhook for user {asset_owner_id}")
            except Exception as commit_error:
                await db.rollback()
                logger.error(
                    "Failed to create asset from tusd webhook for user %s: %s",
                    user_id_raw,
                    commit_error,
                )
        
        response_payload = {
            "success": True,
            "file_path": str(file_path),
            "filename": filename_override or file_path.name,
            "size_bytes": size_bytes,
            "compatible_for_copy": validation_result["compatible_for_copy"],
            "validation_errors": validation_result.get("validation_errors", []),
            "meta": stream_info,
            "warnings": stream_info.get("warnings", []),
            "recommendation": stream_info.get("recommendation"),
        }

        if created_asset:
            response_payload["asset_id"] = str(created_asset.id)
            response_payload["asset_type"] = created_asset.asset_type
        elif isinstance(stream_info, dict):
            response_payload["asset_type"] = infer_asset_type(stream_info, "video")

        return response_payload
        
    except Exception as e:
        logger.exception(f"Error processing upload: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process upload: {str(e)}"
        )


@router.post("/{asset_id}/check", response_model=AssetResponse)
async def revalidate_asset(
    asset_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Re-run validation for an existing asset and refresh stored metadata."""
    if validator is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Video validator is not available on the server.",
        )

    db, user_id = user_deps

    query = select(Asset).where(Asset.id == asset_id, Asset.user_id == user_id)
    result = await db.execute(query)
    asset = result.scalar_one_or_none()

    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )

    file_path = Path(asset.storage_path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset file missing on disk",
        )

    previous_size = asset.size_bytes or 0

    try:
        validation_result = await validator.validate_file(file_path)
        meta = validation_result.get("meta", {})
        stream_info = validator.get_stream_info(meta)

        asset.meta = stream_info
        asset.size_bytes = file_path.stat().st_size
        asset.duration_seconds = stream_info.get("duration")
        asset.compatible_for_copy = validation_result["compatible_for_copy"]
        asset.validation_errors = validation_result.get("validation_errors", [])

        apply_stream_summary_fields(asset, stream_info)
        asset.asset_type = normalize_asset_type(asset.asset_type, stream_info)

        await _apply_storage_delta(db, user_id, asset.size_bytes - previous_size)
        await db.commit()
        await db.refresh(asset)
        serialized = await _serialize_assets(db, user_id, [asset])
        return serialized[0]
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error during asset revalidation: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to revalidate asset",
        ) from exc


@router.post("/{asset_id}/download-link", response_model=AssetDownloadLinkResponse)
async def create_download_link(
    asset_id: UUID,
    request: Request,
    user_deps: tuple = Depends(require_user),
):
    """Generate a short-lived download URL for the asset."""
    db, user_id = user_deps

    query = select(Asset).where(Asset.id == asset_id, Asset.user_id == user_id)
    result = await db.execute(query)
    asset = result.scalar_one_or_none()

    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )

    if not Path(asset.storage_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset file missing on disk",
        )

    token, expires_at = generate_download_token(asset.id, user_id)
    download_url = request.url_for("download_asset_by_token", token=token)

    logger.debug("Generated download token for asset %s valid until %s", asset.id, expires_at)

    expires_dt = datetime.fromtimestamp(expires_at, tz=timezone.utc)

    return AssetDownloadLinkResponse(
        download_url=str(download_url),
        expires_at=expires_dt,
    )


@router.get("/download/{token}", name="download_asset_by_token")
async def download_asset_by_token(token: str, db: AsyncSession = Depends(get_db)):
    """Serve asset file using a signed, time-limited token."""
    asset_id, user_id, _ = parse_download_token(token)

    query = select(Asset).where(Asset.id == asset_id, Asset.user_id == user_id)
    result = await db.execute(query)
    asset = result.scalar_one_or_none()

    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )

    file_path = Path(asset.storage_path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset file missing on disk",
        )

    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=asset.filename,
    )


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(
    asset_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Get asset details"""
    db, user_id = user_deps
    
    try:
        query = select(Asset).where(
            Asset.id == asset_id,
            Asset.user_id == user_id
        )
        result = await db.execute(query)
        asset = result.scalar_one_or_none()
        
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found"
            )
        
        serialized = await _serialize_assets(db, user_id, [asset])
        return serialized[0]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting asset: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get asset: {str(e)}"
        )


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: UUID,
    user_deps: tuple = Depends(require_user),
    force: bool = Query(
        default=False,
        description="Force deletion even if asset is used in playlists, collections, or streams.",
    ),
):
    """Delete an asset and its file"""
    db, user_id = user_deps
    
    try:
        # Get asset
        query = select(Asset).where(
            Asset.id == asset_id,
            Asset.user_id == user_id
        )
        result = await db.execute(query)
        asset = result.scalar_one_or_none()
        
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found"
            )

        playlist_usage, collection_usage, stream_usage = await _collect_asset_usage(
            db, user_id, [asset.id]
        )
        usage_summary = AssetUsageSummary(
            playlists=playlist_usage.get(asset.id, []),
            collections=collection_usage.get(asset.id, []),
            streams=stream_usage.get(asset.id, []),
        )

        if isinstance(force, bool):
            force_value = force
        else:
            force_value = bool(getattr(force, "default", False))

        if (
            (usage_summary.playlists or usage_summary.collections or usage_summary.streams)
            and not force_value
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "asset_in_use",
                    "message": "Asset is referenced by other resources; use force=true to remove it.",
                    "usage": usage_summary.model_dump(mode="json"),
                },
            )

        collection_rows = await db.execute(
            select(CollectionItem.collection_id).where(CollectionItem.asset_id == asset_id)
        )
        impacted_collections = [row[0] for row in collection_rows if row[0]]
        
        size_delta = -(asset.size_bytes or 0)

        # Delete file from disk along with associated tusd metadata (.info)
        file_path = Path(asset.storage_path)
        info_candidates = set()
        if file_path.suffix:
            info_candidates.add(file_path.with_suffix(file_path.suffix + ".info"))
        info_candidates.add(file_path.with_name(file_path.name + ".info"))

        if file_path.exists():
            file_path.unlink()
            logger.info(f"Deleted file: {file_path}")

        for info_path in info_candidates:
            if info_path.exists():
                try:
                    info_path.unlink()
                    logger.info("Deleted companion info file: %s", info_path)
                except Exception as info_err:
                    logger.warning("Failed to delete info file %s: %s", info_path, info_err)
        
        # Delete from database
        await db.execute(delete(Asset).where(Asset.id == asset_id))
        await _apply_storage_delta(db, user_id, size_delta)
        await _audit_collection_quorum(db, impacted_collections, asset_id)

        db.add(
            UserActivityLog(
                user_id=user_id,
                activity_type="asset_deleted",
                details={
                    "asset_id": str(asset_id),
                    "force": force_value,
                    "usage": usage_summary.model_dump(mode="json"),
                },
            )
        )
        await db.commit()
        
        logger.info(f"Deleted asset {asset_id}")
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error deleting asset: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete asset: {str(e)}"
        )
