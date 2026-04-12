"""Storage helpers shared across asset services."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.database import (
    CollectionItem,
    MediaCollection,
    SystemAlert,
    UserProfile,
)

logger = logging.getLogger(__name__)

SUPPORTED_ASSET_STORAGE_BACKENDS = {"filesystem", "object_storage"}
LEGACY_FILESYSTEM_UPLOAD_ROOTS = (
    Path("/app/uploads"),
    Path("/uploads"),
)


def normalize_storage_backend(raw_value: object) -> str:
    if raw_value is None:
        return "filesystem"
    candidate = str(raw_value).strip().lower()
    if not candidate:
        return "filesystem"
    if candidate not in SUPPORTED_ASSET_STORAGE_BACKENDS:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unsupported asset storage backend: {candidate}",
        )
    return candidate


def remap_legacy_user_upload_path(
    candidate: Path, upload_root: Path, user_id: UUID
) -> Path:
    for legacy_root in LEGACY_FILESYSTEM_UPLOAD_ROOTS:
        legacy_user_root = (legacy_root / str(user_id)).resolve(strict=False)
        if candidate == legacy_user_root:
            return (upload_root / str(user_id)).resolve(strict=False)
        if legacy_user_root in candidate.parents:
            relative_path = candidate.relative_to(legacy_user_root)
            return (upload_root / str(user_id) / relative_path).resolve(strict=False)
    return candidate


def require_user_filesystem_path(
    raw_path: str, user_id: UUID, *, must_exist: bool
) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="storage_path is required",
        )

    candidate = Path(raw_path).expanduser().resolve(strict=False)
    upload_root = Path(settings.upload_dir).resolve(strict=False)
    expected_root = (upload_root / str(user_id)).resolve(strict=False)
    candidate = remap_legacy_user_upload_path(candidate, upload_root, user_id)

    if candidate != expected_root and expected_root not in candidate.parents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Asset storage_path must be within the user's upload directory",
        )

    if must_exist and (not candidate.exists() or not candidate.is_file()):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset file missing on disk",
        )

    return candidate


def get_asset_storage_backend(asset: object) -> str:
    return normalize_storage_backend(getattr(asset, "storage_backend", None))


def get_asset_storage_key(asset: object) -> Optional[str]:
    backend = get_asset_storage_backend(asset)
    storage_key = getattr(asset, "storage_key", None)
    if isinstance(storage_key, str) and storage_key.strip():
        return storage_key.strip()
    if backend == "filesystem":
        storage_path = getattr(asset, "storage_path", None)
        if isinstance(storage_path, str) and storage_path.strip():
            return str(Path(storage_path).expanduser().resolve(strict=False))
    return None


def resolve_asset_local_path(asset: object, user_id: UUID, *, must_exist: bool) -> Path:
    backend = get_asset_storage_backend(asset)
    storage_path = getattr(asset, "storage_path", None)

    if backend == "filesystem":
        return require_user_filesystem_path(
            storage_path,
            user_id,
            must_exist=must_exist,
        )

    local_path = require_user_filesystem_path(
        storage_path,
        user_id,
        must_exist=False,
    )
    if local_path.exists() and local_path.is_file():
        return local_path

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "asset_local_file_unavailable",
            "message": "Asset local cache is unavailable; remote hydration is not implemented yet.",
            "storage_backend": backend,
            "storage_key": get_asset_storage_key(asset),
        },
    )


async def apply_storage_delta(
    db: AsyncSession, user_id: UUID, delta_bytes: int
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


async def audit_collection_quorum(
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
            asset_id=asset_id,
            message=f"Collection '{collection.name}' no longer contains assets",
            details={
                "collection_id": str(collection.id),
                "collection_type": collection.collection_type,
            },
        )
        db.add(alert)
