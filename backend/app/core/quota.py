"""
Quota Enforcement Module

Middleware and decorators for enforcing subscription tier limits
across all API operations.
"""

from typing import Optional, List, Dict, Any
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
import logging
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta

from app.models.database import (
    UserProfile,
    SubscriptionTierLimits,
    Asset,
    Playlist,
    Destination,
    Stream,
    SystemAlert,
)
from app.core.rtmp_url_validator import (
    InvalidDestinationURL,
    validate_destination_url,
)

# Postgres advisory-lock namespaces. The two-arg ``pg_advisory_xact_lock(int4, int4)``
# form takes a (namespace, key) pair and is auto-released at transaction end.
# We hash the user_id with ``hashtext`` (postgres built-in, returns int4) so
# every distinct user gets a distinct lock without UUID-byte truncation
# collisions that the original ``user_id.bytes[:8]`` scheme allowed.
QUOTA_LOCK_NAMESPACE_START_STREAM = 0x59545253  # 'YTRS' — ascii literal
QUOTA_LOCK_NAMESPACE_DESTINATIONS = 0x59544445  # 'YTDE'
QUOTA_LOCK_NAMESPACE_ASSETS = 0x59544153  # 'YTAS'
QUOTA_LOCK_NAMESPACE_STORAGE = 0x59545353  # 'YTSS'
# Restart-counter namespace: keyed by stream_id (NOT user_id) so two failures
# of the same stream serialize while two different streams progress in
# parallel. Used by ffmpeg_manager._persist_restart_state.
QUOTA_LOCK_NAMESPACE_RESTART_COUNTER = 0x59545243  # 'YTRC'

# All four namespaces share the same hash function so the same user_id maps
# to the same key within each namespace; this keeps reads predictable in
# pg_locks while guaranteeing no cross-namespace contention.


async def acquire_user_quota_lock(
    db: AsyncSession,
    user_id: UUID,
    namespace: int,
) -> None:
    """Acquire a tx-scoped advisory lock for ``(namespace, user_id)``.

    The lock is released automatically when the surrounding transaction
    commits or rolls back. Callers must therefore execute the entire
    ``check + write`` sequence within a single transaction for the TOCTOU
    guarantee to hold.

    Uses ``hashtext`` (deterministic FNV-style 32-bit hash) to derive the
    second key from the user UUID. Collisions are still theoretically
    possible (32-bit space), but acceptable: a collision merely serializes
    two unrelated users on the same lock for the duration of one quota
    check, which is correct and benign — never a *correctness* issue.
    """
    await db.execute(
        text(
            "SELECT pg_advisory_xact_lock(:ns, hashtext(:user_id))",
        ),
        {"ns": namespace, "user_id": str(user_id)},
    )


logger = logging.getLogger(__name__)


# Sprint 8.1 split: stream-quality TypedDicts + constants moved to quota_quality.py.
# Re-export here so existing imports (`from app.core.quota import AUDIO_QUALITY_GUIDANCE`)
# keep working without churn across the codebase.
from app.core.quota_quality import (  # noqa: E402,F401
    AUDIO_QUALITY_GUIDANCE,
    MIN_AUDIO_SAMPLE_RATE_HZ,
    SUPPORTED_AUDIO_CODECS,
    AudioQualityGuidance,
    VideoBitrateGuidanceEntry,
    evaluate_stream_quality_sync,
)


class QuotaExceededError(HTTPException):
    """Custom exception for quota exceeded errors"""

    def __init__(
        self,
        resource: str,
        current: int | float,
        limit: int | float,
        tier: str,
        upgrade_required: bool = True,
    ):
        detail = {
            "error": "quota_exceeded",
            "resource": resource,
            "current": current,
            "limit": limit,
            "tier": tier,
            "upgrade_required": upgrade_required,
            "message": f"{resource.title()} limit reached ({current}/{limit}). "
            f"Upgrade your plan to create more {resource}.",
        }
        super().__init__(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=detail)


def missing_tier_limits_detail(tier: Optional[str]) -> Dict[str, Any]:
    normalized_tier = tier or "unknown"
    return {
        "error": "tier_limits_unavailable",
        "tier": normalized_tier,
        "message": (
            "Subscription tier limits are unavailable for this account. "
            "Streaming quality and launch checks cannot proceed until tier metadata is restored."
        ),
    }


class QuotaEnforcer:
    """
    Service for checking and enforcing quota limits.
    Used as dependency in API endpoints.
    """

    def __init__(self, db: AsyncSession, user_id: UUID):
        self.db = db
        self.user_id = user_id
        self._profile: Optional[UserProfile] = None
        self._limits: Optional[SubscriptionTierLimits] = None

    async def _load_profile(self):
        """Load user profile if not already loaded"""
        if self._profile is None:
            result = await self.db.execute(
                select(UserProfile).where(UserProfile.user_id == self.user_id)
            )
            self._profile = result.scalar_one_or_none()

            if not self._profile:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User profile not found",
                )

    def _require_profile(self) -> UserProfile:
        assert self._profile is not None
        return self._profile

    async def _load_limits(self):
        """Load tier limits if not already loaded"""
        await self._load_profile()
        profile = self._require_profile()

        if self._limits is None:
            result = await self.db.execute(
                select(SubscriptionTierLimits).where(
                    SubscriptionTierLimits.tier == profile.subscription_tier
                )
            )
            self._limits = result.scalar_one_or_none()

            if not self._limits:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=missing_tier_limits_detail(profile.subscription_tier),
                )

    def _require_limits(self) -> SubscriptionTierLimits:
        assert self._limits is not None
        return self._limits

    async def check_suspended(self):
        """Check if user is suspended"""
        await self._load_profile()
        profile = self._require_profile()

        if profile.is_suspended:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "account_suspended",
                    "reason": profile.suspension_reason
                    or "Account suspended. Contact support.",
                    "contact": "support@yourplatform.com",
                },
            )

    async def check_concurrent_streams(self) -> bool:
        """
        Check if user can start another concurrent stream.

        Holds a tx-scoped advisory lock on the user's start-stream namespace
        for the duration of the check, so two concurrent ``POST /api/streams/{id}/start``
        requests from the same user serialize and the count→insert race
        cannot pass two requests through a quota of one. The lock is also
        held by ``services/streams/control.py::_acquire_user_start_lock``
        on the same namespace, so the check and the insert share the lock.

        Returns:
            bool: True if allowed

        Raises:
            QuotaExceededError: If limit reached
        """
        await self.check_suspended()
        await self._load_limits()
        limits = self._require_limits()
        profile = self._require_profile()

        await acquire_user_quota_lock(
            self.db, self.user_id, QUOTA_LOCK_NAMESPACE_START_STREAM
        )

        # Get current active streams count
        result = await self.db.execute(
            select(func.count(Stream.id)).where(
                Stream.user_id == self.user_id,
                Stream.status.in_(["running", "starting"]),
            )
        )
        active_count = result.scalar() or 0

        limit = limits.max_concurrent_streams

        if limit is not None and active_count >= limit:
            # Create system alert
            await self._create_alert(
                "quota_exceeded",
                f"Concurrent streams quota exceeded: {active_count}/{limit}",
                {"resource": "streams", "count": active_count, "limit": limit},
            )

            raise QuotaExceededError(
                resource="concurrent streams",
                current=active_count,
                limit=limit,
                tier=profile.subscription_tier,
            )

        await self._check_daily_streaming_limit()

        return True

    async def get_daily_streaming_usage(self) -> Dict[str, Any]:
        """Return detailed usage data for the rolling 24-hour streaming window."""

        await self._load_limits()
        limits = self._require_limits()
        profile = self._require_profile()

        limit_hours = limits.daily_streaming_limit_hours
        tier = profile.subscription_tier

        usage: Dict[str, Any] = {
            "limit_hours": float(limit_hours) if limit_hours is not None else None,
            "limit_seconds": (
                float(limit_hours * 3600) if limit_hours is not None else None
            ),
            "used_seconds": 0.0,
            "remaining_seconds": None,
            "limit_reached": False,
            "tier": tier,
        }

        if not limit_hours:
            return usage

        window_end = datetime.now(timezone.utc)
        window_start = window_end - timedelta(hours=24)

        # Compute the rolling-24h streaming seconds entirely in SQL using
        # ``EXTRACT(EPOCH FROM ...)`` over the clipped per-row interval.
        # Pre-Sprint-5 this loaded every overlapping stream row into Python
        # and walked the list to sum durations — fine on small tenants but
        # an O(N) memory + transit cost on heavy users. The new aggregate
        # returns one row, one number.
        sql = text("""
            SELECT COALESCE(
                SUM(
                    EXTRACT(
                        EPOCH FROM (
                            LEAST(
                                COALESCE(stopped_at, :window_end),
                                :window_end
                            )
                            - GREATEST(started_at, :window_start)
                        )
                    )
                ),
                0
            )
            FROM streams
            WHERE user_id = :user_id
              AND started_at IS NOT NULL
              AND COALESCE(stopped_at, :window_end) > :window_start
              AND started_at < :window_end
            """)
        row = await self.db.execute(
            sql,
            {
                "user_id": str(self.user_id),
                "window_start": window_start,
                "window_end": window_end,
            },
        )
        total_seconds = float(row.scalar() or 0.0)
        if total_seconds < 0:
            total_seconds = 0.0

        limit_seconds = float(limit_hours) * 3600.0
        remaining_seconds = max(limit_seconds - total_seconds, 0.0)

        usage.update(
            {
                "used_seconds": total_seconds,
                "remaining_seconds": remaining_seconds,
                "limit_seconds": limit_seconds,
                "limit_reached": remaining_seconds <= 0.0,
            }
        )

        return usage

    async def _check_daily_streaming_limit(self) -> bool:
        """Ensure the user has not exceeded the daily streaming allowance."""

        usage = await self.get_daily_streaming_usage()
        limit_seconds = usage.get("limit_seconds")
        if not limit_seconds:
            return True

        used_seconds = usage.get("used_seconds", 0.0)
        if used_seconds < limit_seconds:
            return True

        limit_hours = usage.get("limit_hours") or (limit_seconds / 3600.0)
        used_hours = used_seconds / 3600.0

        await self._create_alert(
            "quota_exceeded",
            f"Daily streaming limit exceeded: {used_hours:.2f}/{limit_hours:.2f} hours",
            {
                "resource": "daily_streaming_hours",
                "count_hours": round(used_hours, 2),
                "limit_hours": limit_hours,
            },
        )

        raise QuotaExceededError(
            resource="daily streaming hours",
            current=round(used_hours, 2),
            limit=limit_hours,
            tier=self._require_profile().subscription_tier,
        )

    async def check_assets_limit(self) -> bool:
        """
        Check if user can create another asset.

        Acquires an advisory lock on the assets namespace so that concurrent
        upload-finalize requests from the same user serialize through the
        quota check, preventing the count→insert race.

        Returns:
            bool: True if allowed

        Raises:
            QuotaExceededError: If limit reached
        """
        await self.check_suspended()
        await self._load_limits()
        limits = self._require_limits()
        profile = self._require_profile()

        await acquire_user_quota_lock(
            self.db, self.user_id, QUOTA_LOCK_NAMESPACE_ASSETS
        )

        result = await self.db.execute(
            select(func.count(Asset.id)).where(Asset.user_id == self.user_id)
        )
        count = result.scalar() or 0

        limit = limits.max_assets

        if limit is not None and count >= limit:
            await self._create_alert(
                "quota_exceeded",
                f"Assets quota exceeded: {count}/{limit}",
                {"resource": "assets", "count": count, "limit": limit},
            )

            raise QuotaExceededError(
                resource="assets",
                current=count,
                limit=limit,
                tier=profile.subscription_tier,
            )

        return True

    async def ensure_destination_allowed(self, rtmps_url: str) -> None:
        """Ensure destination URL is permitted for the user's subscription tier.

        Validation pipeline (defence in depth):

        1. Tier-level YouTube-only enforcement runs *before* DNS so users on
           the free tier cannot waste a DNS lookup on an attacker-controlled
           hostname.
        2. ``validate_destination_url`` rejects non-rtmp(s) schemes, hostnames
           with tee meta-characters, denied/disallowed ports, and any
           hostname that resolves to a private/loopback/link-local/reserved
           address (SSRF / cloud-metadata mitigation).
        3. The DNS-rebinding residual is mitigated by re-validating at
           ``start_stream`` time — see ``services/streams/control.py``.
        """

        await self.check_suspended()
        await self._load_limits()
        limits = self._require_limits()
        profile = self._require_profile()

        parsed = urlparse(rtmps_url or "")
        hostname = (parsed.hostname or "").lower()

        # Tier gate first — cheaper than a DNS round-trip and keeps an
        # attacker's free-tier custom-host attempts off the resolver.
        # Both `rtmp.youtube.com` and `rtmps.youtube.com` are official
        # YouTube ingest hostnames (a.rtmps.youtube.com has been the
        # recommended secure ingest since 2020). Accept both on the free
        # tier; bug surfaced by Track B real-stream test 2026-04-26.
        if not limits.custom_rtmps_enabled:
            if not (
                hostname.endswith("rtmp.youtube.com")
                or hostname.endswith("rtmps.youtube.com")
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "error": "custom_rtmps_not_allowed",
                        "message": "Your plan does not allow custom RTMPS destinations",
                        "tier": profile.subscription_tier,
                    },
                )

        try:
            validate_destination_url(rtmps_url)
        except InvalidDestinationURL as exc:
            logger.warning(
                "rejected destination URL for user=%s code=%s: %s",
                self.user_id,
                exc.code,
                exc.message,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": exc.code, "message": exc.message},
            ) from exc

    async def evaluate_stream_quality(
        self,
        video_assets: List[Dict[str, Any]],
        *,
        audio_assets: Optional[List[Dict[str, Any]]] = None,
        mix_mode: str = "video_only",
    ) -> Dict[str, Any]:
        """Validate selected assets against tier quality limits.

        Sprint 8.1 thin façade: setup phase loads profile + limits, body
        delegates to the pure evaluate_stream_quality_sync helper in
        quota_quality.py. Behavior is byte-identical with the prior
        571-line implementation; the split keeps quota.py under the
        800-LOC ceiling.
        """

        await self.check_suspended()
        await self._load_limits()
        limits = self._require_limits()
        profile = self._require_profile()

        return evaluate_stream_quality_sync(
            profile=profile,
            limits=limits,
            video_assets=video_assets,
            audio_assets=audio_assets,
            mix_mode=mix_mode,
        )

    async def check_playlists_limit(self) -> bool:
        """
        Check if user can create another playlist.

        Returns:
            bool: True if allowed

        Raises:
            QuotaExceededError: If limit reached
        """
        await self.check_suspended()
        await self._load_limits()
        limits = self._require_limits()
        profile = self._require_profile()

        result = await self.db.execute(
            select(func.count(Playlist.id)).where(Playlist.user_id == self.user_id)
        )
        count = result.scalar() or 0

        limit = limits.max_playlists

        if limit is not None and count >= limit:
            await self._create_alert(
                "quota_exceeded",
                f"Playlists quota exceeded: {count}/{limit}",
                {"resource": "playlists", "count": count, "limit": limit},
            )

            raise QuotaExceededError(
                resource="playlists",
                current=count,
                limit=limit,
                tier=profile.subscription_tier,
            )

        return True

    async def check_destinations_limit(self) -> bool:
        """
        Check if user can create another destination.

        Acquires an advisory lock on the destinations namespace so concurrent
        ``POST /api/destinations`` requests from the same user serialize
        through the quota gate.

        Returns:
            bool: True if allowed

        Raises:
            QuotaExceededError: If limit reached
        """
        await self.check_suspended()
        await self._load_limits()
        limits = self._require_limits()
        profile = self._require_profile()

        await acquire_user_quota_lock(
            self.db, self.user_id, QUOTA_LOCK_NAMESPACE_DESTINATIONS
        )

        result = await self.db.execute(
            select(func.count(Destination.id)).where(
                Destination.user_id == self.user_id
            )
        )
        count = result.scalar() or 0

        limit = limits.max_destinations

        if limit is not None and count >= limit:
            await self._create_alert(
                "quota_exceeded",
                f"Destinations quota exceeded: {count}/{limit}",
                {"resource": "destinations", "count": count, "limit": limit},
            )

            raise QuotaExceededError(
                resource="destinations",
                current=count,
                limit=limit,
                tier=profile.subscription_tier,
            )

        return True

    async def check_storage_limit(self, additional_bytes: int = 0) -> bool:
        """
        Check if user has enough storage quota.

        Holds the STORAGE-namespace advisory lock so two concurrent upload
        finalize calls cannot both pass the cap and double-charge the
        user. The actual storage delta is applied by
        ``services/assets/storage.py::apply_storage_delta`` in the same
        request transaction, so the lock outlives the check.

        Args:
            additional_bytes: Additional bytes to check

        Returns:
            bool: True if allowed

        Raises:
            QuotaExceededError: If limit reached
        """
        await self.check_suspended()
        await self._load_limits()
        limits = self._require_limits()
        profile = self._require_profile()

        await acquire_user_quota_lock(
            self.db, self.user_id, QUOTA_LOCK_NAMESPACE_STORAGE
        )

        current_bytes = profile.current_storage_bytes or 0
        limit_bytes = limits.storage_gb * 1024**3 if limits.storage_gb else float("inf")

        if current_bytes + additional_bytes > limit_bytes:
            used_gb = current_bytes / (1024**3)

            await self._create_alert(
                "quota_exceeded",
                f"Storage quota exceeded: {used_gb:.2f}/{limits.storage_gb} GB",
                {
                    "resource": "storage",
                    "used_gb": used_gb,
                    "limit_gb": limits.storage_gb,
                },
            )

            raise QuotaExceededError(
                resource="storage",
                current=round(used_gb, 2),
                limit=limits.storage_gb or 0,
                tier=profile.subscription_tier,
            )

        return True

    async def _create_alert(self, alert_type: str, message: str, details: dict):
        """Create a system alert for quota exceeded"""
        try:
            alert = SystemAlert(
                user_id=self.user_id,
                alert_type=alert_type,
                severity="warning",
                message=message,
                details=details,
                resolved=False,
            )
            self.db.add(alert)
            await self.db.flush()

            logger.warning(
                f"Quota exceeded alert created for user {self.user_id}: {message}"
            )
        except Exception as e:
            logger.error(f"Failed to create alert: {e}")
            # Don't fail the main operation
