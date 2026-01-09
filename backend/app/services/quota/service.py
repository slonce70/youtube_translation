"""Business logic supporting quota endpoints."""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.metrics import track_quota_denied
from app.core.observability import capture_alert
from app.models.database import (
    Asset,
    Destination,
    Playlist,
    Stream,
    SubscriptionTierLimits,
    UserProfile,
)
from app.schemas.quota import QuotaCheckRequest, QuotaCheckResponse, QuotaUsageResponse

logger = logging.getLogger(__name__)
_warned_missing_secret = False


class QuotaService:
    """Encapsulates quota calculations and validations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def check_quota_internal(self, raw_body: bytes, signature: Optional[str]) -> QuotaCheckResponse:
        """Validate tusd hook payload and answer whether upload is permitted."""

        global _warned_missing_secret

        if not raw_body:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request body is required")

        secret = settings.tusd_hmac_secret
        if secret:
            if not signature:
                capture_alert(
                    "tusd_hmac_missing",
                    tags={"component": "tusd", "event": "hmac_missing"},
                )
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing tusd signature")

            expected_signature = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected_signature, signature):
                capture_alert(
                    "tusd_hmac_invalid",
                    tags={"component": "tusd", "event": "hmac_invalid"},
                )
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid tusd signature")
        else:
            environment = settings.environment.lower()
            if environment in {"production", "staging"}:
                logger.error("TUSD_HMAC_SECRET must be configured for environment '%s'", settings.environment)
                capture_alert(
                    "tusd_hmac_secret_missing",
                    level="error",
                    tags={"component": "tusd", "event": "hmac_secret_missing"},
                )
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Quota service misconfigured",
                )
            if not _warned_missing_secret:
                logger.warning("TUSD_HMAC_SECRET is not configured; accepting unsigned quota checks")
                _warned_missing_secret = True

        try:
            payload = QuotaCheckRequest.model_validate_json(raw_body)
        except ValidationError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc

        profile = await self._get_or_create_profile(payload.user_id)
        if not profile:
            return QuotaCheckResponse(can_upload=False, reason="User not found")

        if profile.is_suspended:
            return QuotaCheckResponse(
                can_upload=False,
                reason=f"Account suspended: {profile.suspension_reason or 'Contact support'}",
            )

        limits = await self._get_limits(profile.subscription_tier)
        current_storage = profile.current_storage_bytes or 0
        max_storage_bytes = limits.storage_gb * 1024**3 if limits.storage_gb else float("inf")

        if current_storage + payload.file_size > max_storage_bytes:
            used_gb = current_storage / (1024**3)
            track_quota_denied()
            capture_alert(
                "quota_denied_storage",
                tags={"component": "quota", "event": "storage_limit"},
                extra={
                    "tier": profile.subscription_tier,
                    "limit_gb": limits.storage_gb,
                },
            )
            return QuotaCheckResponse(
                can_upload=False,
                reason=(
                    f"Storage quota exceeded ({used_gb:.2f}/{limits.storage_gb} GB). "
                    "Upgrade your plan to upload more."
                ),
                current_usage={
                    "storage_gb": used_gb,
                    "limit_gb": limits.storage_gb,
                    "tier": profile.subscription_tier,
                },
            )

        if limits.max_assets:
            assets_count = await self._count_records(Asset, payload.user_id)
            if assets_count >= limits.max_assets:
                track_quota_denied()
                capture_alert(
                    "quota_denied_assets",
                    tags={"component": "quota", "event": "asset_limit"},
                    extra={
                        "tier": profile.subscription_tier,
                        "limit": limits.max_assets,
                    },
                )
                return QuotaCheckResponse(
                    can_upload=False,
                    reason=(
                        f"Asset limit reached ({assets_count}/{limits.max_assets} assets). "
                        "Upgrade your plan or delete old assets."
                    ),
                    current_usage={
                        "assets_count": assets_count,
                        "limit": limits.max_assets,
                        "tier": profile.subscription_tier,
                    },
                )

        return QuotaCheckResponse(
            can_upload=True,
            current_usage={
                "storage_gb": current_storage / (1024**3),
                "limit_gb": limits.storage_gb,
                "tier": profile.subscription_tier,
            },
        )

    async def get_user_quota(self, user_id: UUID) -> QuotaUsageResponse:
        profile = await self._get_profile(user_id)
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found")

        limits = await self._get_limits(profile.subscription_tier)

        total_storage = profile.current_storage_bytes or 0
        storage_gb = total_storage / (1024**3)
        storage_limit = limits.storage_gb
        storage_percent = (storage_gb / storage_limit * 100) if storage_limit else 0

        active_streams_count = await self._count_streams(user_id, ["running", "starting"])
        streams_limit = limits.max_concurrent_streams
        streams_percent = (active_streams_count / streams_limit * 100) if streams_limit else 0

        destinations_count = await self._count_records(Destination, user_id)
        destinations_limit = limits.max_destinations
        destinations_percent = (destinations_count / destinations_limit * 100) if destinations_limit else 0

        playlists_count = await self._count_records(Playlist, user_id)
        playlists_limit = limits.max_playlists
        playlists_percent = (playlists_count / playlists_limit * 100) if playlists_limit else 0

        assets_count = await self._count_records(Asset, user_id)
        assets_limit = limits.max_assets
        assets_percent = (assets_count / assets_limit * 100) if assets_limit else 0

        daily_hours = await self._calculate_recent_stream_hours(user_id)
        limit_hours = limits.daily_streaming_limit_hours
        streaming_percent = (daily_hours / limit_hours * 100) if limit_hours else 0

        return QuotaUsageResponse(
            storage={
                "used_bytes": total_storage,
                "used_gb": round(storage_gb, 2),
                "limit_gb": storage_limit,
                "percent": round(storage_percent, 1),
                "unlimited": storage_limit is None,
            },
            streams={
                "active": active_streams_count,
                "limit": streams_limit,
                "percent": round(streams_percent, 1),
                "unlimited": streams_limit is None,
            },
            destinations={
                "count": destinations_count,
                "limit": destinations_limit,
                "percent": round(destinations_percent, 1),
                "unlimited": destinations_limit is None,
            },
            playlists={
                "count": playlists_count,
                "limit": playlists_limit,
                "percent": round(playlists_percent, 1),
                "unlimited": playlists_limit is None,
            },
            assets={
                "count": assets_count,
                "limit": assets_limit,
                "percent": round(assets_percent, 1),
                "unlimited": assets_limit is None,
            },
            streaming_hours={
                "used": daily_hours,
                "limit": limit_hours,
                "percent": round(streaming_percent, 1),
                "unlimited": limit_hours is None,
            },
            quality={
                "max_resolution": limits.max_resolution,
                "max_resolution_height": limits.max_resolution_height,
                "max_fps": limits.max_fps,
                "allowed_video_codecs": limits.allowed_video_codecs or [],
                "enforce_stream_quality": limits.enforce_stream_quality,
            },
            tier=profile.subscription_tier,
        )

    async def _get_profile(self, user_id: UUID) -> Optional[UserProfile]:
        result = await self.db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
        return result.scalar_one_or_none()

    async def _get_or_create_profile(self, user_id: UUID) -> Optional[UserProfile]:
        profile = await self._get_profile(user_id)
        if profile:
            return profile

        if settings.environment == "production":
            return None

        profile = UserProfile(
            user_id=user_id,
            email=f"user-{user_id}@local.dev",
            subscription_tier="free",
            subscription_status="active",
        )
        self.db.add(profile)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            return await self._get_profile(user_id)
        except Exception:
            await self.db.rollback()
            logger.exception("Failed to auto-create user profile during quota check")
            return None
        else:
            logger.info("Auto-created user profile %s for quota check", user_id)
            await self.db.refresh(profile)
            return profile

    async def _get_limits(self, tier: str) -> SubscriptionTierLimits:
        result = await self.db.execute(select(SubscriptionTierLimits).where(SubscriptionTierLimits.tier == tier))
        limits = result.scalar_one_or_none()
        if not limits:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid subscription tier: {tier}")
        return limits

    async def _count_records(self, model, user_id: UUID) -> int:
        result = await self.db.execute(select(func.count(model.id)).where(model.user_id == user_id))
        return result.scalar() or 0

    async def _count_streams(self, user_id: UUID, statuses: list[str]) -> int:
        result = await self.db.execute(
            select(func.count(Stream.id)).where(Stream.user_id == user_id, Stream.status.in_(statuses))
        )
        return result.scalar() or 0

    async def _calculate_recent_stream_hours(self, user_id: UUID) -> float:
        window_end = datetime.now(timezone.utc)
        window_start = window_end - timedelta(hours=24)
        result = await self.db.execute(
            select(Stream).where(
                Stream.user_id == user_id,
                Stream.started_at.isnot(None),
                func.coalesce(Stream.stopped_at, func.now()) >= window_start,
            )
        )
        recent_streams = result.scalars().all()

        total_seconds = 0.0
        for stream in recent_streams:
            started_at = stream.started_at
            if not started_at:
                continue

            stopped_at = stream.stopped_at or window_end
            if stopped_at <= window_start:
                continue

            effective_start = max(started_at, window_start)
            effective_end = max(stopped_at, effective_start)
            total_seconds += (effective_end - effective_start).total_seconds()

        return round(total_seconds / 3600.0, 2)
