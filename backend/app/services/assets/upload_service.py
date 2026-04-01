"""Handling of tusd webhook uploads."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.quota import QuotaEnforcer
from app.models.database import Asset
from app.schemas.api import ALLOWED_ASSET_TYPES

from .storage import apply_storage_delta
from .thumbnails import generate_video_thumbnail
from .utils import (
    apply_stream_summary_fields,
    infer_asset_type,
    normalize_asset_type,
    verify_upload_token,
)
from .validation import validator

logger = logging.getLogger(__name__)


class AssetUploadService:
    """Processes tusd post-finish hooks and persists assets."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def handle_upload_complete(
        self, upload_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        event_block = upload_data.get("Event") or {}
        event_type = upload_data.get("Type") or event_block.get("Type")
        upload_meta = upload_data.get("Upload") or event_block.get("Upload") or {}
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

        file_path = await self._resolve_file_path(
            storage_payload, upload_meta, upload_id
        )
        if not file_path:
            logger.error(
                "Upload file not found after retries: id=%s storage=%s",
                upload_id,
                storage_payload,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Uploaded file not found on disk",
            )

        logger.info("Processing upload: %s", file_path)
        self._ensure_within_upload_root(file_path)

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

        meta_payload = self._extract_meta_payload(
            upload_data, upload_meta, storage_payload
        )
        asset_owner_id = self._resolve_asset_owner(meta_payload, upload_id)
        self._ensure_user_directory(asset_owner_id, file_path)

        created_asset = None
        enforcer = QuotaEnforcer(self.db, asset_owner_id)
        await enforcer.check_assets_limit()
        await enforcer.check_storage_limit(size_bytes)

        created_asset = await self._persist_asset(
            asset_owner_id=asset_owner_id,
            filename_override=meta_payload.get("filename"),
            upload_id=upload_id,
            file_path=file_path,
            size_bytes=size_bytes,
            validation_result=validation_result,
            stream_info=stream_info,
            meta_payload=meta_payload,
        )

        response_payload: Dict[str, Any] = {
            "success": True,
            "file_path": str(file_path),
            "filename": meta_payload.get("filename") or file_path.name,
            "size_bytes": size_bytes,
            "compatible_for_copy": validation_result.get("compatible_for_copy", False),
            "validation_errors": validation_result.get("validation_errors", []),
            "meta": stream_info,
            "warnings": stream_info.get("warnings", []),
            "recommendation": stream_info.get("recommendation"),
        }

        if created_asset:
            response_payload["asset_id"] = str(created_asset.id)
            response_payload["asset_type"] = created_asset.asset_type
        elif isinstance(stream_info, dict):
            response_payload["asset_type"] = infer_asset_type(
                stream_info,
                "video",
                filename=meta_payload.get("filename") or file_path.name,
            )

        return response_payload

    async def _persist_asset(
        self,
        *,
        asset_owner_id: UUID,
        filename_override: Optional[str],
        upload_id: Optional[str],
        file_path: Path,
        size_bytes: int,
        validation_result: Dict[str, Any],
        stream_info: Dict[str, Any],
        meta_payload: Dict[str, Any],
    ) -> Optional[Asset]:
        summary_meta = stream_info if isinstance(stream_info, dict) else {}
        user_requested_type = (meta_payload.get("asset_type") or "video").lower()
        if user_requested_type not in ALLOWED_ASSET_TYPES:
            user_requested_type = "video"

        resolved_asset_type = normalize_asset_type(
            user_requested_type,
            summary_meta,
            filename=filename_override or file_path.name,
        )
        if user_requested_type == "audio" and resolved_asset_type == "video":
            logger.warning(
                "Asset type mismatch for upload %s: user requested 'audio' but file contains video streams."
                " Treating as video. File: %s, User: %s",
                upload_id,
                file_path.name,
                asset_owner_id,
            )
            validation_errors = validation_result.get("validation_errors", [])
            validation_errors.append(
                "File contains video streams but was uploaded as audio-only. "
                "Please re-upload using 'Video' mode or use an audio-only file."
            )
            validation_result["validation_errors"] = validation_errors

        asset = Asset(
            user_id=asset_owner_id,
            filename=filename_override or file_path.name,
            storage_path=str(file_path),
            size_bytes=size_bytes,
            duration_seconds=stream_info.get("duration"),
            meta=stream_info,
            compatible_for_copy=validation_result.get("compatible_for_copy", False),
            validation_errors=validation_result.get("validation_errors", []),
            asset_type=resolved_asset_type,
            codec_info=validation_result.get("meta"),
        )

        apply_stream_summary_fields(asset, summary_meta)
        self.db.add(asset)
        await apply_storage_delta(self.db, asset_owner_id, size_bytes)
        await self.db.commit()
        await self.db.refresh(asset)
        logger.info(
            "Created asset %s from tusd webhook for user %s", asset.id, asset_owner_id
        )

        if resolved_asset_type == "video":
            await self._generate_thumbnail(asset, file_path)

        return asset

    async def _generate_thumbnail(self, asset: Asset, file_path: Path) -> None:
        thumbnails_dir = Path(settings.upload_dir) / "thumbnails"
        thumbnail_url = await generate_video_thumbnail(
            video_path=file_path,
            output_dir=thumbnails_dir,
            asset_id=asset.id,
        )

        if thumbnail_url:
            existing_meta = asset.meta if isinstance(asset.meta, dict) else {}
            asset_meta = dict(existing_meta)
            asset_meta["thumbnail_url"] = thumbnail_url
            asset.meta = asset_meta
            await self.db.commit()
            await self.db.refresh(asset)
            logger.info("Added thumbnail URL to asset %s: %s", asset.id, thumbnail_url)
        else:
            logger.warning("Failed to generate thumbnail for asset %s", asset.id)

    async def _resolve_file_path(
        self,
        storage_payload: Dict[str, Any],
        upload_meta: Dict[str, Any],
        upload_id: Optional[str],
    ) -> Optional[Path]:
        async def resolve() -> Optional[Path]:
            def resolve_path(path_value: Optional[str]) -> Optional[Path]:
                if not path_value:
                    return None
                candidate = Path(path_value)
                return candidate if candidate.exists() else None

            raw_path = (
                storage_payload.get("Path")
                if isinstance(storage_payload, dict)
                else None
            )
            file_candidate = resolve_path(raw_path)

            if not file_candidate or not file_candidate.is_file():
                info_path_value = (
                    storage_payload.get("InfoPath")
                    if isinstance(storage_payload, dict)
                    else None
                )
                info_path = resolve_path(info_path_value)
                if info_path and info_path.is_file():
                    try:
                        info_data = json.loads(info_path.read_text(encoding="utf-8"))
                        raw_storage_path = info_data.get("Storage", {}).get(
                            "Path"
                        ) or info_data.get("storage", {}).get("path")
                        candidate = resolve_path(raw_storage_path)
                        if candidate and candidate.is_file():
                            file_candidate = candidate
                        elif info_data.get("ID"):
                            fallback = Path(settings.upload_dir) / info_data["ID"]
                            if fallback.exists():
                                file_candidate = fallback
                    except Exception as info_error:  # pylint: disable=broad-except
                        logger.warning(
                            "Failed to parse tusd info file %s: %s",
                            info_path,
                            info_error,
                        )

            if (not file_candidate or not file_candidate.is_file()) and upload_id:
                fallback = Path(settings.upload_dir) / upload_id
                if fallback.exists():
                    file_candidate = fallback

            return (
                file_candidate if file_candidate and file_candidate.is_file() else None
            )

        for _ in range(6):
            candidate = await resolve()
            if candidate:
                return candidate
            await asyncio.sleep(0.5)
        return None

    def _ensure_within_upload_root(self, file_path: Path) -> None:
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
                detail="Invalid upload path detected",
            )

    def _extract_meta_payload(
        self,
        upload_data: Dict[str, Any],
        upload_meta: Dict[str, Any],
        storage_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        event_block = upload_data.get("Event") or {}
        meta_payload = (
            upload_data.get("Meta")
            or upload_meta.get("MetaData")
            or event_block.get("Upload", {}).get("MetaData")
            or upload_data.get("meta")
            or {}
        )

        if not meta_payload:
            info_path_value = (
                storage_payload.get("InfoPath")
                if isinstance(storage_payload, dict)
                else None
            )
            if info_path_value:
                info_file = Path(info_path_value)
                if info_file.exists():
                    try:
                        info_data = json.loads(info_file.read_text(encoding="utf-8"))
                        meta_payload = info_data.get("MetaData", {}) or {}
                    except Exception as info_error:  # pylint: disable=broad-except
                        logger.warning(
                            "Unable to read metadata from %s: %s",
                            info_file,
                            info_error,
                        )
        project_id_raw = meta_payload.get("project_id")
        if project_id_raw:
            logger.info(
                "Ignoring legacy project_id %s in tusd metadata", project_id_raw
            )
        return meta_payload

    def _resolve_asset_owner(
        self, meta_payload: Dict[str, Any], upload_id: Optional[str]
    ) -> UUID:
        token = meta_payload.get("upload_token")
        if not token:
            logger.error("Missing upload token for tusd upload %s", upload_id)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Missing upload token",
            )

        try:
            owner_id = verify_upload_token(token)
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception(
                "Unexpected error verifying upload token for %s", upload_id
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid upload token",
            ) from exc

        user_id_raw = meta_payload.get("user_id")
        if user_id_raw and user_id_raw != str(owner_id):
            logger.warning(
                "Upload %s provided mismatched user_id %s (token resolved %s)",
                upload_id,
                user_id_raw,
                owner_id,
            )
        elif not user_id_raw:
            logger.info(
                "Upload %s omitted user_id metadata; token resolved %s",
                upload_id,
                owner_id,
            )

        return owner_id

    def _ensure_user_directory(self, user_id: UUID, file_path: Path) -> None:
        expected_root = (Path(settings.upload_dir) / str(user_id)).resolve()
        resolved_path = file_path.resolve()
        if expected_root not in resolved_path.parents:
            logger.error(
                "Upload file path %s not located under user %s directory (%s)",
                resolved_path,
                user_id,
                expected_root,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Upload path does not match token owner",
            )
