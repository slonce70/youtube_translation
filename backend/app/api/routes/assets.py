from __future__ import annotations

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_user
from app.core.database import get_db
from app.schemas.api import (
    AssetCreate,
    AssetDownloadLinkResponse,
    AssetResponse,
    AssetUpdate,
)
from app.services.assets import AssetService, AssetUploadService
from app.services.assets.service import AssetDownloadService, DownloadTokenService
from app.services.assets.utils import infer_asset_type, normalize_asset_type  # noqa: F401

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/", response_model=List[AssetResponse])
async def list_assets(
    asset_type: Optional[str] = Query(None, description="Filter by asset type: video | audio"),
    folder_id: Optional[UUID] = Query(None, description="Filter by folder ID and descendants"),
    user_deps: tuple = Depends(require_user),
):
    """List assets for current user."""
    db, user_id = user_deps
    service = AssetService(db, user_id)
    return await service.list_assets(asset_type, folder_id)


@router.post("/", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
async def create_asset(asset_data: AssetCreate, user_deps: tuple = Depends(require_user)):
    """Persist a new asset record (post-upload)."""
    db, user_id = user_deps
    service = AssetService(db, user_id)
    return await service.create_asset(asset_data)


@router.patch("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: UUID,
    asset_update: AssetUpdate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service = AssetService(db, user_id)
    return await service.update_asset(asset_id, asset_update)


@router.post("/upload-complete")
async def handle_upload_complete(request: Request, db: AsyncSession = Depends(get_db)):
    """Webhook invoked by tusd once file upload completes."""
    try:
        payload = await request.json()
    except Exception as parse_error:  # pylint: disable=broad-except
        raw_body = await request.body()
        logger.error(
            "Invalid webhook payload from tusd: %s (%s)", raw_body[:500], parse_error
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid tusd webhook payload",
        ) from parse_error

    service = AssetUploadService(db)
    return await service.handle_upload_complete(payload)


@router.post("/{asset_id}/check", response_model=AssetResponse)
async def revalidate_asset(asset_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    service = AssetService(db, user_id)
    return await service.revalidate_asset(asset_id)


@router.post("/{asset_id}/download-link", response_model=AssetDownloadLinkResponse)
async def create_download_link(
    asset_id: UUID,
    request: Request,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service = AssetService(db, user_id)
    token, expires_at = await service.create_download_token(asset_id)
    download_url = request.url_for("download_asset_by_token", token=token)
    return AssetDownloadLinkResponse(download_url=str(download_url), expires_at=expires_at)


@router.get("/download/{token}", name="download_asset_by_token")
async def download_asset_by_token(token: str, db: AsyncSession = Depends(get_db)):
    """Serve asset file when provided with a signed token."""
    asset_id, user_id, _ = DownloadTokenService.parse_token(token)
    asset = await AssetDownloadService.resolve_asset(db, asset_id, user_id)
    file_path = AssetDownloadService.ensure_file_exists(asset)
    return FileResponse(file_path, media_type="application/octet-stream", filename=asset.filename)


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(asset_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    service = AssetService(db, user_id)
    return await service.get_asset(asset_id)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: UUID,
    user_deps: tuple = Depends(require_user),
    force: bool = Query(
        default=False,
        description="Force deletion even if asset is referenced by other resources.",
    ),
):
    db, user_id = user_deps
    service = AssetService(db, user_id)
    force_value = force if isinstance(force, bool) else bool(getattr(force, "default", False))
    await service.delete_asset(asset_id, force_value)
