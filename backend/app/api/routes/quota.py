"""Quota Management API."""

import logging
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_user
from app.core.database import get_db
from app.schemas.quota import QuotaCheckResponse, QuotaUsageResponse
from app.services.quota import QuotaService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/internal/check-quota", response_model=QuotaCheckResponse)
async def check_quota_internal(
    request: Request,
    db: AsyncSession = Depends(get_db),
    signature: Optional[str] = Header(default=None, alias="X-Tusd-Signature"),
):
    """
    Internal endpoint for tusd pre-create hook.
    Checks if user has enough quota to upload a file.
    
    This endpoint does NOT require authentication (called by tusd hook).
    Security: Only accessible from localhost (configured in Caddy/nginx)
    """
    service = QuotaService(db)
    try:
        raw_body = await request.body()
        return await service.check_quota_internal(raw_body, signature)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error during internal quota check")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Quota check service unavailable",
        )


# ==========================================
# User-facing Endpoints
# ==========================================

@router.get("/quota", response_model=QuotaUsageResponse)
async def get_user_quota(
    user_deps: tuple = Depends(require_user),
):
    """
    Get current user's quota usage and limits.
    Shows how much of each resource they're using.
    """
    db, user_id = user_deps

    try:
        user_uuid = UUID(str(user_id))
    except (ValueError, TypeError):
        user_uuid = user_id

    service = QuotaService(db)
    return await service.get_user_quota(user_uuid)
