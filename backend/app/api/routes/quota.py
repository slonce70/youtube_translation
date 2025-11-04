"""
Quota Management API

Endpoints for checking and managing user quotas based on subscription tiers.
"""

from fastapi import APIRouter, HTTPException, status, Depends, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, ValidationError
from uuid import UUID
from typing import Optional
import hashlib
import hmac
import logging

from app.api.deps import require_user
from app.core.database import get_db
from app.models.database import (
    UserProfile, SubscriptionTierLimits,
    Asset, Playlist, Destination, Stream
)
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


# ==========================================
# Request/Response Models
# ==========================================

class QuotaCheckRequest(BaseModel):
    """Request to check if upload is allowed"""
    user_id: UUID
    file_size: int


class QuotaCheckResponse(BaseModel):
    """Response with quota check result"""
    can_upload: bool
    reason: Optional[str] = None
    current_usage: Optional[dict] = None


class QuotaUsageResponse(BaseModel):
    """User's quota usage and limits"""
    storage: dict
    streams: dict
    destinations: dict
    playlists: dict
    assets: dict
    tier: str


# ==========================================
# Internal Endpoints (for tusd hooks)
# ==========================================

_warned_missing_secret = False


@router.post("/internal/check-quota", response_model=QuotaCheckResponse)
async def check_quota_internal(
    request: Request,
    db: AsyncSession = Depends(get_db),
    signature: Optional[str] = Header(default=None, alias="X-Tusd-Signature")
):
    """
    Internal endpoint for tusd pre-create hook.
    Checks if user has enough quota to upload a file.
    
    This endpoint does NOT require authentication (called by tusd hook).
    Security: Only accessible from localhost (configured in Caddy/nginx)
    """
    global _warned_missing_secret

    try:
        raw_body = await request.body()

        if not raw_body:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Request body is required"
            )

        secret = settings.tusd_hmac_secret
        if secret:
            if not signature:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Missing tusd signature"
                )

            expected_signature = hmac.new(
                secret.encode("utf-8"),
                raw_body,
                hashlib.sha256
            ).hexdigest()

            if not hmac.compare_digest(expected_signature, signature):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid tusd signature"
                )
        else:
            if not _warned_missing_secret:
                logger.warning("TUSD_HMAC_SECRET is not configured; falling back to unsigned quota check requests")
                _warned_missing_secret = True

        try:
            payload = QuotaCheckRequest.model_validate_json(raw_body)
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=exc.errors()
            )

        # Get user profile
        result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == payload.user_id)
        )
        profile = result.scalar_one_or_none()
        
        if not profile:
            if settings.environment != "production":
                placeholder_email = f"user-{payload.user_id}@local.dev"
                profile = UserProfile(
                    user_id=payload.user_id,
                    email=placeholder_email,
                    subscription_tier="free",
                    subscription_status="active",
                )

                db.add(profile)
                try:
                    await db.commit()
                except IntegrityError:
                    await db.rollback()
                    result = await db.execute(
                        select(UserProfile).where(UserProfile.user_id == payload.user_id)
                    )
                    profile = result.scalar_one_or_none()
                except Exception:
                    await db.rollback()
                    logger.exception("Failed to auto-create user profile during quota check")
                    return QuotaCheckResponse(
                        can_upload=False,
                        reason="User profile creation failed"
                    )
                else:
                    logger.info(
                        "Auto-created user profile %s for quota check", payload.user_id
                    )
                    await db.refresh(profile)
            if not profile:
                return QuotaCheckResponse(
                    can_upload=False,
                    reason="User not found"
                )
        
        # Check if user is suspended
        if profile.is_suspended:
            return QuotaCheckResponse(
                can_upload=False,
                reason=f"Account suspended: {profile.suspension_reason or 'Contact support'}"
            )
        
        # Get tier limits
        result = await db.execute(
            select(SubscriptionTierLimits).where(
                SubscriptionTierLimits.tier == profile.subscription_tier
            )
        )
        limits = result.scalar_one_or_none()
        
        if not limits:
            return QuotaCheckResponse(
                can_upload=False,
                reason=f"Invalid subscription tier: {profile.subscription_tier}"
            )
        
        # Check storage quota
        current_storage = profile.current_storage_bytes or 0
        max_storage_bytes = limits.storage_gb * 1024**3 if limits.storage_gb else float('inf')
        
        if current_storage + payload.file_size > max_storage_bytes:
            used_gb = current_storage / (1024**3)
            return QuotaCheckResponse(
                can_upload=False,
                reason=f"Storage quota exceeded ({used_gb:.2f}/{limits.storage_gb} GB). Upgrade your plan to upload more.",
                current_usage={
                    "storage_gb": used_gb,
                    "limit_gb": limits.storage_gb,
                    "tier": profile.subscription_tier
                }
            )
        
        # Check assets count
        if limits.max_assets:
            result = await db.execute(
                select(func.count(Asset.id)).where(Asset.user_id == payload.user_id)
            )
            assets_count = result.scalar()
            
            if assets_count >= limits.max_assets:
                return QuotaCheckResponse(
                    can_upload=False,
                    reason=f"Asset limit reached ({assets_count}/{limits.max_assets} assets). Upgrade your plan or delete old assets.",
                    current_usage={
                        "assets_count": assets_count,
                        "limit": limits.max_assets,
                        "tier": profile.subscription_tier
                    }
                )
        
        # All checks passed
        return QuotaCheckResponse(
            can_upload=True,
            current_usage={
                "storage_gb": current_storage / (1024**3),
                "limit_gb": limits.storage_gb,
                "tier": profile.subscription_tier
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error during internal quota check")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Quota check service unavailable"
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

    # Get user profile
    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == user_uuid)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found"
        )
    
    # Get tier limits
    result = await db.execute(
        select(SubscriptionTierLimits).where(
            SubscriptionTierLimits.tier == profile.subscription_tier
        )
    )
    limits = result.scalar_one()
    
    # Calculate current usage
    
    # Storage
    total_storage = profile.current_storage_bytes or 0
    storage_gb = total_storage / (1024**3)
    storage_limit = limits.storage_gb
    storage_percent = (storage_gb / storage_limit * 100) if storage_limit else 0
    
    # Active streams
    result = await db.execute(
        select(func.count(Stream.id)).where(
            Stream.user_id == user_uuid,
            Stream.status.in_(['running', 'starting'])
        )
    )
    active_streams_count = result.scalar()
    streams_limit = limits.max_concurrent_streams
    streams_percent = (active_streams_count / streams_limit * 100) if streams_limit else 0
    
    # Destinations
    result = await db.execute(
        select(func.count(Destination.id)).where(Destination.user_id == user_uuid)
    )
    destinations_count = result.scalar()
    destinations_limit = limits.max_destinations
    destinations_percent = (destinations_count / destinations_limit * 100) if destinations_limit else 0
    
    # Playlists
    result = await db.execute(
        select(func.count(Playlist.id)).where(Playlist.user_id == user_uuid)
    )
    playlists_count = result.scalar()
    playlists_limit = limits.max_playlists
    playlists_percent = (playlists_count / playlists_limit * 100) if playlists_limit else 0
    
    # Assets
    result = await db.execute(
        select(func.count(Asset.id)).where(Asset.user_id == user_uuid)
    )
    assets_count = result.scalar()
    assets_limit = limits.max_assets
    assets_percent = (assets_count / assets_limit * 100) if assets_limit else 0
    
    return QuotaUsageResponse(
        storage={
            "used_bytes": total_storage,
            "used_gb": round(storage_gb, 2),
            "limit_gb": storage_limit,
            "percent": round(storage_percent, 1),
            "unlimited": storage_limit is None
        },
        streams={
            "active": active_streams_count,
            "limit": streams_limit,
            "percent": round(streams_percent, 1),
            "unlimited": streams_limit is None
        },
        destinations={
            "count": destinations_count,
            "limit": destinations_limit,
            "percent": round(destinations_percent, 1),
            "unlimited": destinations_limit is None
        },
        playlists={
            "count": playlists_count,
            "limit": playlists_limit,
            "percent": round(playlists_percent, 1),
            "unlimited": playlists_limit is None
        },
        assets={
            "count": assets_count,
            "limit": assets_limit,
            "percent": round(assets_percent, 1),
            "unlimited": assets_limit is None
        },
        tier=profile.subscription_tier
    )
