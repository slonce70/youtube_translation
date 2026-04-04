from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_user
from app.core.config import settings
from app.core.database import get_db
from app.schemas.api import (
    AssetCreate,
    AssetDownloadLinkResponse,
    AssetResponse,
    AssetUpdate,
    UploadIngestResponse,
    UploadTokenResponse,
)
from app.services.assets import AssetService, AssetUploadService, UploadTokenService
from app.services.assets.service import AssetDownloadService, DownloadTokenService
from app.services.assets import utils as asset_utils

infer_asset_type = asset_utils.infer_asset_type
normalize_asset_type = asset_utils.normalize_asset_type

logger = logging.getLogger(__name__)
_warned_missing_tusd_secret = False

router = APIRouter()


def _upload_complete_status_code(result: dict) -> int:
    if result.get("success", True):
        return status.HTTP_200_OK

    http_status = result.get("http_status")
    if isinstance(http_status, int):
        return http_status
    if isinstance(http_status, str) and http_status.isdigit():
        return int(http_status)

    error_code = str(result.get("error_code") or "").strip()
    if error_code.startswith("http_"):
        http_status = error_code.removeprefix("http_")
        if http_status.isdigit():
            return int(http_status)

    if error_code == "upload_file_missing":
        return status.HTTP_404_NOT_FOUND

    return status.HTTP_500_INTERNAL_SERVER_ERROR


def _verify_tusd_signature(raw_body: bytes, signature: Optional[str]) -> None:
    """Validate incoming tusd webhook signatures."""

    global _warned_missing_tusd_secret

    secret = settings.tusd_hmac_secret
    if not secret:
        environment = settings.environment.lower()
        if environment in {"production", "staging"}:
            logger.error("TUSD_HMAC_SECRET must be configured to verify tusd hooks")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Upload hook misconfigured",
            )
        if not _warned_missing_tusd_secret:
            logger.warning(
                "TUSD_HMAC_SECRET not configured; accepting unsigned tusd hooks"
            )
            _warned_missing_tusd_secret = True
        return

    if not signature:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing tusd signature",
        )

    expected_signature = hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected_signature, signature):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid tusd signature",
        )


@router.get("/", response_model=List[AssetResponse])
async def list_assets(
    asset_type: Optional[str] = Query(
        None, description="Filter by asset type: video | audio"
    ),
    folder_id: Optional[UUID] = Query(
        None, description="Filter by folder ID and descendants"
    ),
    user_deps: tuple = Depends(require_user),
):
    """List assets for current user."""
    db, user_id = user_deps
    service = AssetService(db, user_id)
    return await service.list_assets(asset_type, folder_id)


@router.post("/", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
async def create_asset(
    asset_data: AssetCreate, user_deps: tuple = Depends(require_user)
):
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


@router.post("/upload-token", response_model=UploadTokenResponse)
async def create_upload_token(user_deps: tuple = Depends(require_user)):
    """Issue a short-lived token for authenticated tus uploads."""
    _, user_id = user_deps
    service = UploadTokenService(user_id)
    return service.create_token()


@router.post("/upload-complete")
async def handle_upload_complete(
    request: Request,
    db: AsyncSession = Depends(get_db),
    signature: Optional[str] = Header(default=None, alias="X-Tusd-Signature"),
):
    """Webhook invoked by tusd once file upload completes."""
    raw_body = await request.body()
    if not raw_body:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing tusd webhook payload",
        )

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError as parse_error:
        logger.error(
            "Invalid webhook payload from tusd: %s (%s)",
            raw_body[:500],
            parse_error,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid tusd webhook payload",
        ) from parse_error

    _verify_tusd_signature(raw_body, signature)

    try:
        service = AssetUploadService(db)
        result = await service.handle_upload_complete(payload)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to process tusd webhook")
        raise

    response_status = _upload_complete_status_code(result)
    if response_status == status.HTTP_200_OK:
        return result
    return JSONResponse(status_code=response_status, content=result)


@router.get("/uploads/{upload_id}", response_model=UploadIngestResponse)
async def get_upload_status(
    upload_id: str,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service = AssetUploadService(db)
    return await service.get_upload_status(upload_id, user_id)


@router.post("/{asset_id}/check", response_model=AssetResponse)
async def revalidate_asset(asset_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    service = AssetService(db, user_id)
    return await service.revalidate_asset(asset_id)


@router.post("/{asset_id}/optimize", response_model=AssetResponse)
async def optimize_asset(asset_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    service = AssetService(db, user_id)
    return await service.optimize_asset(asset_id)


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
    return AssetDownloadLinkResponse(
        download_url=str(download_url), expires_at=expires_at
    )


@router.get("/download/{token}", name="download_asset_by_token")
async def download_asset_by_token(token: str, db: AsyncSession = Depends(get_db)):
    """Serve asset file when provided with a signed token."""
    asset_id, user_id, _ = DownloadTokenService.parse_token(token)
    asset = await AssetDownloadService.resolve_asset(db, asset_id, user_id)
    file_path = AssetDownloadService.ensure_file_exists(asset, user_id)
    return FileResponse(
        file_path, media_type="application/octet-stream", filename=asset.filename
    )


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
    force_value = (
        force if isinstance(force, bool) else bool(getattr(force, "default", False))
    )
    await service.delete_asset(asset_id, force_value)
