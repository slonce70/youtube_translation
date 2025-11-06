from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Tuple, Dict, Any, Optional
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
from app.models.database import Asset
from app.schemas.api import AssetResponse, AssetCreate, AssetUpdate, AssetDownloadLinkResponse
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

@router.get("/", response_model=List[AssetResponse])
async def list_assets(
    user_deps: tuple = Depends(require_user)
):
    """List all video assets for current user"""
    db, user_id = user_deps
    
    try:
        # Build query - filter by user_id directly
        query = select(Asset).where(Asset.user_id == user_id)
        
        result = await db.execute(query)
        assets = result.scalars().all()
        
        return assets
        
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
        
        # Create asset record - directly for user_id
        asset = Asset(
            user_id=user_id,
            filename=asset_data.filename,
            storage_path=asset_data.storage_path,
            size_bytes=asset_data.size_bytes,
            duration_seconds=asset_data.duration_seconds,
            meta=asset_data.meta,
            compatible_for_copy=asset_data.compatible_for_copy,
            validation_errors=asset_data.validation_errors
        )

        if isinstance(asset_data.meta, dict):
            apply_stream_summary_fields(asset, asset_data.meta)
        
        db.add(asset)
        await db.commit()
        await db.refresh(asset)
        
        logger.info(f"Created asset {asset.id} for user {user_id}")
        
        return asset
        
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
        return asset

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
            try:
                asset = Asset(
                    user_id=asset_owner_id,
                    filename=filename_override or file_path.name,
                    storage_path=str(file_path),
                    size_bytes=size_bytes,
                    duration_seconds=stream_info.get("duration"),
                    meta=stream_info,
                    compatible_for_copy=validation_result["compatible_for_copy"],
                    validation_errors=validation_result.get("validation_errors", []),
                )

                apply_stream_summary_fields(asset, stream_info)

                db.add(asset)
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

        await db.commit()
        await db.refresh(asset)
        return asset
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
    download_path = router.url_path_for("download_asset_by_token", token=token)
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
        
        return asset
        
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
    user_deps: tuple = Depends(require_user)
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
