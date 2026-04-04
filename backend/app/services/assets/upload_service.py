"""Handling of tusd webhook uploads."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.quota import QuotaEnforcer
from app.models.database import Asset, UploadIngest
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

        meta_payload = self._extract_meta_payload(
            upload_data, upload_meta, storage_payload
        )
        asset_owner_id = self._resolve_asset_owner(meta_payload, upload_id)
        filename = meta_payload.get("filename") or upload_meta.get("Name")
        ingest = await self._get_or_create_ingest(
            upload_id=upload_id,
            user_id=asset_owner_id,
            filename=filename,
        )

        if ingest.status == "finalized" and ingest.asset_id:
            return await self._build_existing_response(ingest)

        try:
            file_path = await self._resolve_file_path(
                storage_payload, upload_meta, upload_id
            )
            if not file_path:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={
                        "error": "upload_file_missing",
                        "message": "Uploaded file not found on disk",
                    },
                )

            file_path = await self._materialize_user_file(
                user_id=asset_owner_id,
                upload_id=upload_id,
                file_path=file_path,
            )
            logger.info("Processing upload %s: %s", upload_id, file_path)
            self._ensure_within_upload_root(file_path)
            self._ensure_user_directory(asset_owner_id, file_path)

            await self._mark_ingest_validating(
                ingest,
                filename=filename or file_path.name,
                local_path=file_path,
            )

            size_bytes = file_path.stat().st_size
            validation_result, stream_info = await self._validate_upload(
                file_path, size_bytes
            )

            enforcer = QuotaEnforcer(self.db, asset_owner_id)
            await enforcer.check_assets_limit()
            await enforcer.check_storage_limit(size_bytes)

            created_asset = await self._persist_asset(
                asset_owner_id=asset_owner_id,
                filename_override=filename,
                upload_id=upload_id,
                file_path=file_path,
                size_bytes=size_bytes,
                validation_result=validation_result,
                stream_info=stream_info,
                meta_payload=meta_payload,
            )
            await apply_storage_delta(self.db, asset_owner_id, size_bytes)

            warning_messages = self._normalize_messages(stream_info.get("warnings", []))
            ingest.asset_id = created_asset.id if created_asset else None
            ingest.filename = filename or file_path.name
            ingest.status = "finalized"
            ingest.storage_backend = (
                created_asset.storage_backend if created_asset else "filesystem"
            )
            ingest.storage_key = (
                created_asset.storage_key if created_asset else str(file_path)
            )
            ingest.local_path = str(file_path)
            ingest.error_code = None
            ingest.error_message = None
            ingest.validation_errors = self._normalize_messages(
                validation_result.get("validation_errors", [])
            )
            ingest.warning_messages = warning_messages
            ingest.failed_at = None
            ingest.finalized_at = self._utcnow()

            await self.db.commit()
            await self.db.refresh(ingest)
            if created_asset is not None:
                await self.db.refresh(created_asset)

            if created_asset and created_asset.asset_type == "video":
                thumbnail_warning = await self._generate_thumbnail(
                    created_asset, file_path
                )
                if thumbnail_warning:
                    ingest.warning_messages = self._normalize_messages(
                        [*warning_messages, thumbnail_warning]
                    )
                    await self.db.commit()
                    await self.db.refresh(ingest)

            return self._build_success_response(
                ingest=ingest,
                asset=created_asset,
                file_path=file_path,
                size_bytes=size_bytes,
                validation_result=validation_result,
                stream_info=stream_info,
            )
        except HTTPException as exc:
            failed_ingest = await self._mark_ingest_failed(
                upload_id=ingest.upload_id,
                user_id=ingest.user_id,
                received_at=ingest.received_at,
                attempt_count=ingest.attempt_count,
                filename=filename,
                error=self._extract_error_detail(exc),
                local_path=Path(ingest.local_path) if ingest.local_path else None,
            )
            response = self._build_failed_response(failed_ingest)
            response["http_status"] = exc.status_code
            return response
        except Exception as exc:
            logger.exception("Failed to finalize upload %s", upload_id)
            failed_ingest = await self._mark_ingest_failed(
                upload_id=ingest.upload_id,
                user_id=ingest.user_id,
                received_at=ingest.received_at,
                attempt_count=ingest.attempt_count,
                filename=filename,
                error={
                    "error": "upload_finalize_failed",
                    "message": str(exc) or "Upload finalization failed",
                },
                local_path=Path(ingest.local_path) if ingest.local_path else None,
            )
            return self._build_failed_response(failed_ingest)

    async def get_upload_status(self, upload_id: str, user_id: UUID) -> UploadIngest:
        result = await self.db.execute(
            select(UploadIngest).where(
                UploadIngest.upload_id == upload_id, UploadIngest.user_id == user_id
            )
        )
        ingest = result.scalar_one_or_none()
        if ingest is None:
            ingest = self._load_failed_manifest(upload_id, user_id)
        if ingest is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Upload ingest not found",
            )
        ingest.validation_errors = self._normalize_messages(ingest.validation_errors)
        ingest.warning_messages = self._normalize_messages(ingest.warning_messages)
        return ingest

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
            storage_backend="filesystem",
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
        await self.db.flush()
        logger.info(
            "Created asset %s from tusd webhook for user %s", asset.id, asset_owner_id
        )

        return asset

    async def _generate_thumbnail(self, asset: Asset, file_path: Path) -> Optional[str]:
        thumbnails_dir = Path(settings.upload_dir) / "thumbnails"
        try:
            thumbnail_url = await generate_video_thumbnail(
                video_path=file_path,
                output_dir=thumbnails_dir,
                asset_id=asset.id,
            )
        except Exception as exc:  # pragma: no cover - thumbnail runtime safety
            logger.warning(
                "Thumbnail generation crashed for asset %s: %s", asset.id, exc
            )
            return "Thumbnail generation failed."

        if thumbnail_url:
            existing_meta = asset.meta if isinstance(asset.meta, dict) else {}
            asset_meta = dict(existing_meta)
            asset_meta["thumbnail_url"] = thumbnail_url
            asset.meta = asset_meta
            await self.db.commit()
            await self.db.refresh(asset)
            logger.info("Added thumbnail URL to asset %s: %s", asset.id, thumbnail_url)
            return None

        logger.warning("Failed to generate thumbnail for asset %s", asset.id)
        return "Thumbnail generation failed."

    async def _validate_upload(
        self, file_path: Path, size_bytes: int
    ) -> tuple[Dict[str, Any], Dict[str, Any]]:
        if validator is None:
            validation_result = {
                "compatible_for_copy": False,
                "meta": {},
                "validation_errors": [
                    "ffprobe is not available on the server. Install FFmpeg or set FFPROBE_BIN."
                ],
            }
            return validation_result, {
                "duration": 0,
                "size_bytes": size_bytes,
                "bitrate": 0,
            }

        validation_result = await validator.validate_file(file_path)
        meta = validation_result.get("meta", {})
        return validation_result, validator.get_stream_info(meta)

    async def _get_or_create_ingest(
        self, *, upload_id: Optional[str], user_id: UUID, filename: Optional[str]
    ) -> UploadIngest:
        if not upload_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing upload id",
            )

        existing = await self._lookup_ingest(upload_id)
        if existing is not None:
            self._ensure_ingest_owner(existing, user_id)
            return existing

        ingest = UploadIngest(
            upload_id=upload_id,
            user_id=user_id,
            filename=filename,
            status="received",
            storage_backend="filesystem",
            validation_errors=[],
            warning_messages=[],
            received_at=self._utcnow(),
        )
        self.db.add(ingest)
        try:
            await self.db.flush()
            return ingest
        except IntegrityError:
            await self.db.rollback()
            existing = await self._lookup_ingest(upload_id)
            if existing is not None:
                self._ensure_ingest_owner(existing, user_id)
                return existing
            raise

    async def _lookup_ingest(self, upload_id: str) -> Optional[UploadIngest]:
        result = await self.db.execute(
            select(UploadIngest).where(UploadIngest.upload_id == upload_id)
        )
        return result.scalar_one_or_none()

    def _ensure_ingest_owner(self, ingest: UploadIngest, user_id: UUID) -> None:
        if ingest.user_id == user_id:
            return
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "upload_id_conflict",
                "message": "Upload id is already associated with another account.",
            },
        )

    async def _mark_ingest_validating(
        self, ingest: UploadIngest, *, filename: str, local_path: Path
    ) -> None:
        ingest.filename = filename
        ingest.local_path = str(local_path)
        ingest.status = "validating"
        ingest.attempt_count = int(ingest.attempt_count or 0) + 1
        ingest.received_at = ingest.received_at or self._utcnow()
        ingest.failed_at = None
        ingest.finalized_at = None
        ingest.error_code = None
        ingest.error_message = None
        ingest.validation_errors = []
        ingest.warning_messages = []
        await self.db.flush()

    async def _mark_ingest_failed(
        self,
        *,
        upload_id: str,
        user_id: UUID,
        received_at,
        attempt_count: int,
        filename: Optional[str],
        error: Dict[str, str],
        local_path: Optional[Path],
    ) -> UploadIngest:
        await self.db.rollback()

        failed_ingest = await self._lookup_ingest(upload_id)
        if failed_ingest is None:
            failed_ingest = UploadIngest(
                upload_id=upload_id,
                user_id=user_id,
                received_at=received_at or self._utcnow(),
            )
            self.db.add(failed_ingest)

        failed_ingest.filename = filename or failed_ingest.filename
        failed_ingest.local_path = (
            str(local_path) if local_path is not None else failed_ingest.local_path
        )
        failed_ingest.status = "failed"
        failed_ingest.storage_backend = "filesystem"
        failed_ingest.failed_at = self._utcnow()
        failed_ingest.finalized_at = None
        failed_ingest.error_code = error.get("error") or "upload_finalize_failed"
        failed_ingest.error_message = (
            error.get("message") or "Upload finalization failed"
        )
        failed_ingest.validation_errors = self._normalize_messages(
            failed_ingest.validation_errors
        )
        failed_ingest.warning_messages = self._normalize_messages(
            failed_ingest.warning_messages
        )
        failed_ingest.attempt_count = max(
            int(failed_ingest.attempt_count or 0),
            int(attempt_count or 0),
            1,
        )
        await self.db.commit()
        await self.db.refresh(failed_ingest)
        return failed_ingest

    async def _build_existing_response(self, ingest: UploadIngest) -> Dict[str, Any]:
        asset = await self.db.get(Asset, ingest.asset_id) if ingest.asset_id else None
        file_path = Path(ingest.local_path) if ingest.local_path else None
        size_bytes = file_path.stat().st_size if file_path and file_path.exists() else 0
        return self._build_success_response(
            ingest=ingest,
            asset=asset,
            file_path=file_path,
            size_bytes=size_bytes,
            validation_result={
                "compatible_for_copy": bool(
                    getattr(asset, "compatible_for_copy", False)
                ),
                "validation_errors": getattr(asset, "validation_errors", []) or [],
            },
            stream_info=(asset.meta if asset and isinstance(asset.meta, dict) else {}),
        )

    def _build_success_response(
        self,
        *,
        ingest: UploadIngest,
        asset: Optional[Asset],
        file_path: Optional[Path],
        size_bytes: int,
        validation_result: Dict[str, Any],
        stream_info: Dict[str, Any],
    ) -> Dict[str, Any]:
        response_payload: Dict[str, Any] = {
            "success": True,
            "upload_id": ingest.upload_id,
            "status": ingest.status,
            "ingest_id": str(ingest.id),
            "file_path": str(file_path) if file_path else ingest.local_path,
            "filename": ingest.filename or (file_path.name if file_path else None),
            "size_bytes": size_bytes,
            "compatible_for_copy": validation_result.get("compatible_for_copy", False),
            "validation_errors": validation_result.get("validation_errors", []),
            "meta": stream_info,
            "warnings": ingest.warning_messages or stream_info.get("warnings", []),
            "recommendation": stream_info.get("recommendation"),
        }

        if asset:
            response_payload["asset_id"] = str(asset.id)
            response_payload["asset_type"] = asset.asset_type
        elif isinstance(stream_info, dict):
            response_payload["asset_type"] = infer_asset_type(
                stream_info,
                "video",
                filename=ingest.filename or (file_path.name if file_path else None),
            )

        return response_payload

    def _build_failed_response(self, ingest: UploadIngest) -> Dict[str, Any]:
        return {
            "success": False,
            "upload_id": ingest.upload_id,
            "status": ingest.status,
            "ingest_id": str(ingest.id),
            "filename": ingest.filename,
            "asset_id": str(ingest.asset_id) if ingest.asset_id else None,
            "error_code": ingest.error_code,
            "error_message": ingest.error_message,
            "validation_errors": ingest.validation_errors or [],
            "warnings": ingest.warning_messages or [],
        }

    async def _materialize_user_file(
        self, *, user_id: UUID, upload_id: Optional[str], file_path: Path
    ) -> Path:
        self._ensure_within_upload_root(file_path)
        upload_root = Path(settings.upload_dir).resolve()
        user_dir = (upload_root / str(user_id)).resolve()
        user_dir.mkdir(parents=True, exist_ok=True)

        resolved_path = file_path.resolve()
        if user_dir in resolved_path.parents:
            return resolved_path

        final_name = upload_id or file_path.name
        final_path = (user_dir / final_name).resolve()
        if final_path.exists():
            return final_path

        file_path.replace(final_path)
        info_source = Path(f"{file_path}.info")
        info_target = Path(f"{final_path}.info")
        if info_source.exists() and not info_target.exists():
            info_source.replace(info_target)
        return final_path

    def _extract_error_detail(self, exc: HTTPException) -> Dict[str, str]:
        detail = getattr(exc, "detail", None)
        if isinstance(detail, dict):
            return {
                "error": str(
                    detail.get("error")
                    or detail.get("code")
                    or f"http_{exc.status_code}"
                ),
                "message": str(
                    detail.get("message")
                    or detail.get("detail")
                    or f"HTTP {exc.status_code}"
                ),
                "http_status": str(exc.status_code),
            }
        if isinstance(detail, str):
            return {
                "error": f"http_{exc.status_code}",
                "message": detail,
                "http_status": str(exc.status_code),
            }
        return {
            "error": f"http_{exc.status_code}",
            "message": str(exc) or f"HTTP {exc.status_code}",
            "http_status": str(exc.status_code),
        }

    def _normalize_messages(self, raw_messages: Any) -> list[str]:
        if not raw_messages:
            return []
        values = raw_messages if isinstance(raw_messages, list) else [raw_messages]
        normalized: list[str] = []
        for value in values:
            text = str(value).strip()
            if text and text not in normalized:
                normalized.append(text)
        return normalized

    def _utcnow(self):
        return datetime.now(timezone.utc)

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

        info_file: Optional[Path] = None
        if isinstance(storage_payload, dict):
            info_path_value = storage_payload.get("InfoPath")
            storage_path_value = storage_payload.get("Path")
            if info_path_value:
                info_file = Path(info_path_value)
            elif storage_path_value:
                info_file = Path(f"{storage_path_value}.info")

        if info_file and info_file.exists():
            try:
                info_data = json.loads(info_file.read_text(encoding="utf-8"))
                info_meta = info_data.get("MetaData", {}) or {}
                if info_meta:
                    if not meta_payload:
                        meta_payload = dict(info_meta)
                    else:
                        for key, value in info_meta.items():
                            if value and not meta_payload.get(key):
                                meta_payload[key] = value
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
            # Tusd pre-create already validated token freshness before the upload
            # was accepted. Post-finish can happen after that deadline for long
            # uploads, so we only require signature integrity here.
            owner_id = verify_upload_token(token, allow_expired=True)
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

    def _load_failed_manifest(
        self, upload_id: str, user_id: UUID
    ) -> Optional[UploadIngest]:
        manifest_path = (
            Path(settings.upload_dir) / "_failed-finalizations" / f"{upload_id}.json"
        )
        if not manifest_path.exists():
            return None

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as manifest_error:  # pylint: disable=broad-except
            logger.warning(
                "Failed to parse upload failure manifest %s: %s",
                manifest_path,
                manifest_error,
            )
            return None

        payload = manifest.get("payload")
        if not isinstance(payload, dict):
            return None

        upload_block = payload.get("Upload") or payload.get("Event", {}).get("Upload") or {}
        meta = upload_block.get("MetaData") or {}
        user_id_raw = meta.get("user_id")
        if user_id_raw != str(user_id):
            return None

        created_at_raw = manifest.get("created_at")
        failed_at = self._parse_manifest_timestamp(created_at_raw) or self._utcnow()
        storage = payload.get("Storage") or upload_block.get("Storage") or {}

        return UploadIngest(
            id=uuid4(),
            upload_id=upload_id,
            user_id=user_id,
            filename=meta.get("filename") or meta.get("name"),
            status="failed",
            storage_backend="filesystem",
            local_path=storage.get("Path"),
            error_code=str(manifest.get("reason") or "upload_finalize_failed"),
            error_message=str(
                manifest.get("details") or "Upload finalization failed before ingest creation"
            ),
            validation_errors=[],
            warning_messages=[],
            attempt_count=1,
            failed_at=failed_at,
            created_at=failed_at,
            updated_at=failed_at,
        )

    def _parse_manifest_timestamp(self, value: Any) -> Optional[datetime]:
        if not isinstance(value, str) or not value.strip():
            return None
        normalized = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed

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
