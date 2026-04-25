"""Business logic for asset operations."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.quota import QuotaEnforcer
from app.models.database import (
    Asset,
    CollectionItem,
    MediaFolder,
    UserActivityLog,
)
from app.schemas.api import (
    AssetCreate,
    AssetResponse,
    AssetUpdate,
    AssetUsageSummary,
    UploadTokenResponse,
)

from .serializers import (
    collect_asset_usage,
    extract_thumbnail_url,
    serialize_assets,
)
from .storage import (
    apply_storage_delta,
    audit_collection_quorum,
    require_user_filesystem_path,
    resolve_asset_local_path,
)
from .utils import (
    apply_stream_summary_fields,
    generate_download_token,
    generate_upload_token,
    normalize_asset_type,
    parse_download_token,
)
from .validation import validator

logger = logging.getLogger(__name__)


class AssetService:
    """Encapsulates all asset-facing operations for a user."""

    def __init__(self, db: AsyncSession, user_id: UUID):
        self.db = db
        self.user_id = user_id

    DEFAULT_LIST_LIMIT = 500
    MAX_LIST_LIMIT = 2000

    async def list_assets(
        self,
        asset_type: Optional[str],
        folder_id: Optional[UUID],
        limit: int = DEFAULT_LIST_LIMIT,
    ) -> List[AssetResponse]:
        bounded = max(1, min(limit, self.MAX_LIST_LIMIT))
        query = select(Asset).where(Asset.user_id == self.user_id)

        normalized_asset_type = (
            asset_type.strip().lower() if isinstance(asset_type, str) else None
        )
        if normalized_asset_type:
            if normalized_asset_type not in {"video", "audio"}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="asset_type must be 'video' or 'audio'",
                )
            query = query.where(Asset.asset_type == normalized_asset_type)

        resolved_folder_id = folder_id if isinstance(folder_id, UUID) else None
        if resolved_folder_id:
            subfolders = await self.db.execute(
                select(MediaFolder.id).where(MediaFolder.user_id == self.user_id)
            )
            available_folders = {row[0] for row in subfolders}
            if resolved_folder_id not in available_folders:
                logger.info(
                    "Requested folder %s not found for user %s; returning empty list",
                    resolved_folder_id,
                    self.user_id,
                )
                return []

            recursive = text("""
                WITH RECURSIVE folder_tree AS (
                    SELECT id FROM media_folders WHERE id = :folder_id
                    UNION ALL
                    SELECT mf.id
                    FROM media_folders mf
                    JOIN folder_tree ft ON mf.parent_id = ft.id
                    WHERE mf.user_id = :user_id
                )
                SELECT asset_id FROM asset_folder_links WHERE folder_id IN (SELECT id FROM folder_tree)
                """)
            result = await self.db.execute(
                recursive,
                {"folder_id": str(resolved_folder_id), "user_id": str(self.user_id)},
            )
            asset_ids = [row[0] for row in result]
            if not asset_ids:
                return []
            query = query.where(Asset.id.in_(asset_ids))

        query = query.order_by(Asset.created_at.desc(), Asset.id.desc()).limit(bounded)
        result = await self.db.execute(query)
        assets = result.scalars().unique().all()
        return await serialize_assets(self.db, self.user_id, assets)

    async def create_asset(self, asset_data: AssetCreate) -> AssetResponse:
        file_path = require_user_filesystem_path(
            asset_data.storage_path, self.user_id, must_exist=True
        )
        size_bytes = file_path.stat().st_size

        enforcer = QuotaEnforcer(self.db, self.user_id)
        await enforcer.check_assets_limit()
        await enforcer.check_storage_limit(size_bytes)

        stream_meta = asset_data.meta if isinstance(asset_data.meta, dict) else {}
        asset = Asset(
            user_id=self.user_id,
            filename=asset_data.filename,
            storage_path=str(file_path),
            storage_backend="filesystem",
            size_bytes=size_bytes,
            duration_seconds=asset_data.duration_seconds,
            meta=asset_data.meta,
            compatible_for_copy=asset_data.compatible_for_copy,
            validation_errors=asset_data.validation_errors,
            asset_type=asset_data.asset_type,
            codec_info=asset_data.codec_info or stream_meta,
        )

        if isinstance(stream_meta, dict):
            apply_stream_summary_fields(asset, stream_meta)
        asset.asset_type = normalize_asset_type(
            asset.asset_type,
            stream_meta,
            filename=asset.filename,
        )

        self.db.add(asset)
        await apply_storage_delta(self.db, self.user_id, asset.size_bytes or 0)
        await self.db.commit()
        await self.db.refresh(asset)

        logger.info("Created asset %s for user %s", asset.id, self.user_id)
        return (await serialize_assets(self.db, self.user_id, [asset]))[0]

    async def update_asset(
        self, asset_id: UUID, asset_update: AssetUpdate
    ) -> AssetResponse:
        asset = await self._get_asset_record(asset_id)

        updated = False
        if asset_update.filename and asset_update.filename.strip():
            asset.filename = asset_update.filename.strip()
            updated = True

        if not updated:
            return (await serialize_assets(self.db, self.user_id, [asset]))[0]

        await self.db.commit()
        await self.db.refresh(asset)
        logger.info("Updated asset %s metadata for user %s", asset.id, self.user_id)
        return (await serialize_assets(self.db, self.user_id, [asset]))[0]

    async def get_asset(self, asset_id: UUID) -> AssetResponse:
        asset = await self._get_asset_record(asset_id)
        return (await serialize_assets(self.db, self.user_id, [asset]))[0]

    async def revalidate_asset(self, asset_id: UUID) -> AssetResponse:
        if validator is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Video validator is not available on the server.",
            )

        asset = await self._get_asset_record(asset_id)
        file_path = resolve_asset_local_path(asset, self.user_id, must_exist=True)

        previous_size = asset.size_bytes or 0

        validation_result = await validator.validate_file(file_path)
        meta = validation_result.get("meta", {})
        stream_info = validator.get_stream_info(meta)

        asset.meta = stream_info
        asset.size_bytes = file_path.stat().st_size
        asset.duration_seconds = stream_info.get("duration")
        asset.compatible_for_copy = validation_result["compatible_for_copy"]
        asset.validation_errors = validation_result.get("validation_errors", [])

        apply_stream_summary_fields(asset, stream_info)
        asset.asset_type = normalize_asset_type(
            asset.asset_type,
            stream_info,
            filename=asset.filename,
        )

        await apply_storage_delta(
            self.db, self.user_id, asset.size_bytes - previous_size
        )
        await self.db.commit()
        await self.db.refresh(asset)
        return (await serialize_assets(self.db, self.user_id, [asset]))[0]

    async def optimize_asset(self, asset_id: UUID) -> AssetResponse:
        asset = await self._get_asset_record(asset_id)

        if asset.asset_type not in {"video", "audio"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only video and audio assets can be optimized",
            )

        try:
            file_path = resolve_asset_local_path(asset, self.user_id, must_exist=True)
        except HTTPException as exc:
            asset.optimization_status = "failed"
            asset.optimization_error = str(exc.detail)
            asset.optimization_updated_at = datetime.now(timezone.utc)
            await self.db.commit()
            await self.db.refresh(asset)
            raise

        strategy = "copy" if asset.compatible_for_copy else "transcode"
        next_status = "ready" if strategy == "copy" else "queued"

        asset.optimization_strategy = strategy
        asset.optimization_status = next_status
        asset.optimized_storage_path = str(file_path) if strategy == "copy" else None
        asset.optimization_error = None
        asset.optimization_updated_at = datetime.now(timezone.utc)

        self.db.add(
            UserActivityLog(
                user_id=self.user_id,
                activity_type="asset_optimization_requested",
                details={
                    "asset_id": str(asset.id),
                    "strategy": strategy,
                    "status": next_status,
                },
            )
        )

        await self.db.commit()
        await self.db.refresh(asset)
        logger.info(
            "Optimization requested for asset %s (user=%s, strategy=%s, status=%s)",
            asset.id,
            self.user_id,
            strategy,
            next_status,
        )
        return (await serialize_assets(self.db, self.user_id, [asset]))[0]

    async def create_download_token(self, asset_id: UUID) -> tuple[str, datetime]:
        asset = await self._get_asset_record(asset_id)
        resolve_asset_local_path(asset, self.user_id, must_exist=True)

        token, expires_at = generate_download_token(asset.id, self.user_id)
        return token, datetime.fromtimestamp(expires_at, tz=timezone.utc)

    async def delete_asset(self, asset_id: UUID, force: bool) -> None:
        asset = await self._get_asset_record(asset_id)

        playlist_usage, collection_usage, stream_usage = await collect_asset_usage(
            self.db, self.user_id, [asset.id]
        )
        usage_summary = AssetUsageSummary(
            playlists=playlist_usage.get(asset.id, []),
            collections=collection_usage.get(asset.id, []),
            streams=stream_usage.get(asset.id, []),
        )

        if (
            usage_summary.playlists
            or usage_summary.collections
            or usage_summary.streams
        ) and not force:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "asset_in_use",
                    "message": "Asset is referenced by other resources; use force=true to remove it.",
                    "usage": usage_summary.model_dump(mode="json"),
                },
            )

        collection_rows = await self.db.execute(
            select(CollectionItem.collection_id).where(
                CollectionItem.asset_id == asset_id
            )
        )
        impacted_collections = [row[0] for row in collection_rows if row[0]]

        size_delta = -(asset.size_bytes or 0)
        try:
            await self.db.execute(delete(Asset).where(Asset.id == asset_id))
            await apply_storage_delta(self.db, self.user_id, size_delta)
            await audit_collection_quorum(self.db, impacted_collections, None)

            self.db.add(
                UserActivityLog(
                    user_id=self.user_id,
                    activity_type="asset_deleted",
                    details={
                        "asset_id": str(asset_id),
                        "force": force,
                        "usage": usage_summary.model_dump(mode="json"),
                    },
                )
            )

            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise

        try:
            self._delete_asset_files(asset)
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "Asset %s deleted in DB but cleanup failed: %s", asset_id, exc
            )
        logger.info("Deleted asset %s", asset_id)

    async def _get_asset_record(self, asset_id: UUID) -> Asset:
        query = select(Asset).where(Asset.id == asset_id, Asset.user_id == self.user_id)
        result = await self.db.execute(query)
        asset = result.scalar_one_or_none()
        if asset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found",
            )
        return asset

    def _delete_asset_files(self, asset: Asset) -> None:
        try:
            file_path = resolve_asset_local_path(asset, self.user_id, must_exist=False)
        except HTTPException as exc:
            logger.warning(
                "Skipping file deletion for asset %s due to invalid storage_path: %s",
                asset.id,
                exc.detail,
            )
            return

        info_candidates = set()
        if file_path.suffix:
            info_candidates.add(file_path.with_suffix(file_path.suffix + ".info"))
        info_candidates.add(file_path.with_name(file_path.name + ".info"))

        if file_path.exists():
            file_path.unlink()
            logger.info("Deleted file: %s", file_path)

        for info_path in info_candidates:
            if info_path.exists():
                try:
                    info_path.unlink()
                    logger.info("Deleted companion info file: %s", info_path)
                except Exception as info_err:  # pylint: disable=broad-except
                    logger.warning(
                        "Failed to delete info file %s: %s", info_path, info_err
                    )

        try:
            thumbnail_url = extract_thumbnail_url(asset)
            if thumbnail_url:
                thumbnail_filename = thumbnail_url.split("/")[-1]
                thumbnails_dir = Path(settings.upload_dir) / "thumbnails"
                thumbnail_path = thumbnails_dir / thumbnail_filename
                if thumbnail_path.exists():
                    thumbnail_path.unlink()
                    logger.info("Deleted thumbnail: %s", thumbnail_path)
        except Exception as thumb_err:  # pylint: disable=broad-except
            logger.warning(
                "Failed to delete thumbnail for asset %s: %s", asset.id, thumb_err
            )


class DownloadTokenService:
    """Utility wrapper for parsing signed download tokens."""

    @staticmethod
    def parse_token(token: str) -> tuple[UUID, UUID, int]:
        return parse_download_token(token)


class UploadTokenService:
    """Issues short-lived upload tokens."""

    def __init__(self, user_id: UUID):
        self.user_id = user_id

    def create_token(self) -> UploadTokenResponse:
        token, expires_at = generate_upload_token(self.user_id)
        return UploadTokenResponse(
            token=token,
            expires_at=datetime.fromtimestamp(expires_at, tz=timezone.utc),
        )


class AssetDownloadService:
    """Helpers for serving downloads via signed tokens."""

    @staticmethod
    async def resolve_asset(db: AsyncSession, asset_id: UUID, user_id: UUID) -> Asset:
        query = select(Asset).where(Asset.id == asset_id, Asset.user_id == user_id)
        result = await db.execute(query)
        asset = result.scalar_one_or_none()
        if asset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found",
            )
        return asset

    @staticmethod
    def ensure_file_exists(asset: Asset, user_id: UUID) -> Path:
        file_path = resolve_asset_local_path(asset, user_id, must_exist=True)
        return file_path


__all__ = [
    "AssetService",
    "AssetDownloadService",
    "DownloadTokenService",
    "UploadTokenService",
]
