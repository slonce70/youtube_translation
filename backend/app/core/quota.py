"""
Quota Enforcement Module

Middleware and decorators for enforcing subscription tier limits
across all API operations.
"""

from functools import wraps
from typing import Optional, Callable, List, Dict, Any, Tuple
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
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
from app.streaming.validator import VideoValidator

logger = logging.getLogger(__name__)

AUDIO_QUALITY_GUIDANCE = {
    "codec": "aac",
    "codec_label": "AAC or MP3",
    "sample_rate_hz": 48_000,
    "min_bitrate_kbps": 128,
    "target_bitrate_kbps": 192,
    "channels": 2,
}

SUPPORTED_AUDIO_CODECS = {"aac", "mp4a", "mp3", "mpga"}
MIN_AUDIO_SAMPLE_RATE_HZ = 44_100


class QuotaExceededError(HTTPException):
    """Custom exception for quota exceeded errors"""

    def __init__(
        self,
        resource: str,
        current: int,
        limit: int,
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

    async def _load_limits(self):
        """Load tier limits if not already loaded"""
        await self._load_profile()

        if self._limits is None:
            result = await self.db.execute(
                select(SubscriptionTierLimits).where(
                    SubscriptionTierLimits.tier == self._profile.subscription_tier
                )
            )
            self._limits = result.scalar_one_or_none()

            if not self._limits:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=missing_tier_limits_detail(self._profile.subscription_tier),
                )

    async def check_suspended(self):
        """Check if user is suspended"""
        await self._load_profile()

        if self._profile.is_suspended:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "account_suspended",
                    "reason": self._profile.suspension_reason
                    or "Account suspended. Contact support.",
                    "contact": "support@yourplatform.com",
                },
            )

    async def check_concurrent_streams(self) -> bool:
        """
        Check if user can start another concurrent stream.

        Returns:
            bool: True if allowed

        Raises:
            QuotaExceededError: If limit reached
        """
        await self.check_suspended()
        await self._load_limits()

        # Get current active streams count
        result = await self.db.execute(
            select(func.count(Stream.id)).where(
                Stream.user_id == self.user_id,
                Stream.status.in_(["running", "starting"]),
            )
        )
        active_count = result.scalar()

        limit = self._limits.max_concurrent_streams

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
                tier=self._profile.subscription_tier,
            )

        await self._check_daily_streaming_limit()

        return True

    async def get_daily_streaming_usage(self) -> Dict[str, Any]:
        """Return detailed usage data for the rolling 24-hour streaming window."""

        await self._load_limits()

        limit_hours = self._limits.daily_streaming_limit_hours
        tier = self._profile.subscription_tier if self._profile else None

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

        streams = await self._streams_within_window(window_start)
        total_seconds = self._calculate_streaming_seconds(
            streams, window_start, window_end
        )

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
            tier=self._profile.subscription_tier,
        )

    async def _streams_within_window(self, window_start: datetime) -> List[Stream]:
        result = await self.db.execute(
            select(Stream).where(
                Stream.user_id == self.user_id,
                Stream.started_at.isnot(None),
                func.coalesce(Stream.stopped_at, func.now()) >= window_start,
            )
        )
        return result.scalars().all()

    @staticmethod
    def _calculate_streaming_seconds(
        streams: List[Stream],
        window_start: datetime,
        window_end: datetime,
    ) -> float:
        total_seconds = 0.0

        for stream in streams:
            started_at = QuotaEnforcer._ensure_aware(stream.started_at)
            if not started_at:
                continue

            stopped_at = QuotaEnforcer._ensure_aware(stream.stopped_at) or window_end

            if stopped_at <= window_start:
                continue

            effective_start = max(started_at, window_start)
            effective_end = min(max(stopped_at, effective_start), window_end)

            total_seconds += (effective_end - effective_start).total_seconds()

        return max(total_seconds, 0.0)

    @staticmethod
    def _ensure_aware(value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    async def check_assets_limit(self) -> bool:
        """
        Check if user can create another asset.

        Returns:
            bool: True if allowed

        Raises:
            QuotaExceededError: If limit reached
        """
        await self.check_suspended()
        await self._load_limits()

        result = await self.db.execute(
            select(func.count(Asset.id)).where(Asset.user_id == self.user_id)
        )
        count = result.scalar()

        limit = self._limits.max_assets

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
                tier=self._profile.subscription_tier,
            )

        return True

    async def ensure_destination_allowed(self, rtmps_url: str) -> None:
        """Ensure destination URL is permitted for the user's subscription tier."""

        await self.check_suspended()
        await self._load_limits()

        parsed = urlparse(rtmps_url or "")

        if parsed.scheme not in {"rtmps", "rtmp"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "invalid_destination",
                    "message": "Destination URL must use rtmps scheme",
                },
            )

        hostname = parsed.hostname or ""
        if not hostname:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "invalid_destination",
                    "message": "Destination URL must include a hostname",
                },
            )

        if not self._limits.custom_rtmps_enabled:
            if not hostname.endswith("rtmp.youtube.com"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "error": "custom_rtmps_not_allowed",
                        "message": "Your plan does not allow custom RTMPS destinations",
                        "tier": self._profile.subscription_tier,
                    },
                )

    async def evaluate_stream_quality(
        self,
        video_assets: List[Dict[str, Any]],
        *,
        audio_assets: Optional[List[Dict[str, Any]]] = None,
        mix_mode: str = "video_only",
    ) -> Dict[str, Any]:
        """Validate selected assets against tier quality limits."""

        await self.check_suspended()
        await self._load_limits()

        audio_assets = list(audio_assets or [])
        normalized_mix = (mix_mode or "video_only").lower()
        if normalized_mix not in {"video_only", "audio_only", "mixed"}:
            normalized_mix = "video_only"

        has_video = bool(video_assets)
        has_audio = bool(audio_assets)

        if normalized_mix == "audio_only" or (not has_video and has_audio):
            mode = "audio"
        elif normalized_mix == "mixed" and has_audio and has_video:
            mode = "mixed"
        elif normalized_mix == "mixed" and has_audio:
            mode = "audio"
        else:
            mode = "video"

        limits = self._limits
        result: Dict[str, Any] = {
            "tier": self._profile.subscription_tier,
            "limits": {
                "max_resolution_height": limits.max_resolution_height,
                "max_fps": limits.max_fps,
                "min_video_bitrate_mbps": limits.min_video_bitrate_mbps,
                "max_video_bitrate_mbps": limits.max_video_bitrate_mbps,
                "enforce_stream_quality": limits.enforce_stream_quality,
            },
            "violations": [],
            "ok": True,
            "mode": mode,
            "audio_recommended": None,
        }

        if has_audio:
            result["audio_recommended"] = {
                "codec": AUDIO_QUALITY_GUIDANCE["codec_label"],
                "sample_rate_hz": AUDIO_QUALITY_GUIDANCE["sample_rate_hz"],
                "min_bitrate_kbps": AUDIO_QUALITY_GUIDANCE["min_bitrate_kbps"],
                "target_bitrate_kbps": AUDIO_QUALITY_GUIDANCE["target_bitrate_kbps"],
                "channels": AUDIO_QUALITY_GUIDANCE["channels"],
            }

        if not limits.enforce_stream_quality:
            return result

        guidance_table = VideoValidator.BITRATE_GUIDANCE

        def _safe_int(value: Any) -> Optional[int]:
            if isinstance(value, (int, float)):
                return int(value)
            if isinstance(value, str) and value.strip():
                try:
                    return int(float(value))
                except ValueError:
                    return None
            return None

        def _safe_float(value: Any) -> Optional[float]:
            if isinstance(value, (int, float)):
                return float(value)
            if isinstance(value, str) and value.strip():
                try:
                    return float(value)
                except ValueError:
                    return None
            return None

        def _normalize_fps(value: Optional[float]) -> Tuple[Optional[int], bool]:
            if value is None or value <= 0:
                return None, True

            diff_30 = abs(value - 30)
            diff_60 = abs(value - 60)

            if diff_30 <= 3:
                return 30, False
            if diff_60 <= 5:
                return 60, False

            bucket = 30 if diff_30 < diff_60 else 60
            return bucket, True

        def _match_guideline(height: Optional[int], fps_value: Optional[float]):
            bucket, out_of_guideline = _normalize_fps(fps_value)

            if height is None:
                return None, bucket, True

            rule = next(
                (
                    entry
                    for entry in guidance_table
                    if height >= entry["min_height"]
                    and height <= entry["max_height"]
                    and (bucket is None or entry["fps"] == bucket)
                ),
                None,
            )

            if rule is None:
                rule = next(
                    (
                        entry
                        for entry in guidance_table
                        if height >= entry["min_height"]
                        and height <= entry["max_height"]
                    ),
                    None,
                )

            return rule, bucket, out_of_guideline

        def _format_bitrate(value: Optional[float]) -> Optional[str]:
            if value is None:
                return None
            return f"{value:.2f} Mbps"

        # Pre-flight validation: incompatible assets should not proceed further.
        for index, asset in enumerate(video_assets):
            meta = asset.get("meta") or {}
            video = meta.get("video") or {}
            audio = meta.get("audio") or {}
            label = (
                asset.get("filename") or asset.get("asset_id") or f"asset #{index + 1}"
            )

            def add_preflight_violation(
                code: str,
                message: str,
                *,
                current: Optional[Any] = None,
                allowed: Optional[Any] = None,
            ) -> None:
                entry = {
                    "code": code,
                    "message": message,
                    "asset_id": asset.get("asset_id"),
                    "filename": label,
                    "position": index,
                }
                if current is not None:
                    entry["current"] = current
                if allowed is not None:
                    entry["allowed"] = allowed
                result["violations"].append(entry)

            if asset.get("compatible_for_copy") is False:
                validation_errors = asset.get("validation_errors") or []
                error_suffix = ""
                if validation_errors:
                    error_suffix = (
                        f" Validation issues: {'; '.join(validation_errors)}."
                    )

                add_preflight_violation(
                    "incompatible_codecs",
                    (
                        "Asset must use H.264 video, AAC audio, and yuv420p pixel format "
                        "for direct streaming." + error_suffix
                    ).strip(),
                )

            if not video or not audio:
                add_preflight_violation(
                    "missing_metadata",
                    "Asset metadata is incomplete for quality checks.",
                )

        if result["violations"]:
            result["ok"] = False
            return result

        recommended_info_set = False

        for index, asset in enumerate(video_assets):
            meta = asset.get("meta") or {}
            video = meta.get("video") or {}
            allowed_codecs = {
                (codec or "").lower()
                for codec in (self._limits.allowed_video_codecs or [])
                if codec
            }

            def add_violation(
                code: str, message: str, current: Any = None, allowed: Any = None
            ):
                result["violations"].append(
                    {
                        "code": code,
                        "message": message,
                        "asset_id": asset.get("asset_id"),
                        "filename": asset.get("filename"),
                        "position": index,
                        "current": current,
                        "allowed": allowed,
                    }
                )

            if not video:
                add_violation(
                    "missing_metadata",
                    "Video metadata is missing. Revalidate the file before streaming.",
                )
                continue

            codec_name = (video.get("codec_name") or video.get("codec") or "").lower()
            if allowed_codecs and codec_name and codec_name not in allowed_codecs:
                add_violation(
                    "codec_not_allowed",
                    "Video codec is not permitted for your plan.",
                    current=codec_name,
                    allowed=", ".join(sorted(allowed_codecs)),
                )
                continue

            height = _safe_int(video.get("height"))
            fps = _safe_float(video.get("fps"))
            bitrate_bps = (
                _safe_float(video.get("bitrate"))
                or _safe_float(meta.get("bitrate"))
                or _safe_float(meta.get("overallBitrate"))
            )
            bitrate_mbps = (bitrate_bps / 1_000_000) if bitrate_bps else None

            guideline_rule, fps_bucket, fps_out_of_guideline = _match_guideline(
                height, fps
            )

            tier_min_bitrate = limits.min_video_bitrate_mbps
            tier_max_bitrate = limits.max_video_bitrate_mbps

            guideline_min = (
                guideline_rule["min_bitrate_mbps"] if guideline_rule else None
            )
            guideline_max = (
                guideline_rule["max_bitrate_mbps"] if guideline_rule else None
            )
            guideline_target = (
                guideline_rule["target_bitrate_mbps"] if guideline_rule else None
            )

            actual_min_bitrate = guideline_min
            actual_max_bitrate = guideline_max

            if tier_min_bitrate is not None:
                actual_min_bitrate = max(
                    actual_min_bitrate or tier_min_bitrate, tier_min_bitrate
                )
            if tier_max_bitrate is not None:
                actual_max_bitrate = min(
                    actual_max_bitrate or tier_max_bitrate, tier_max_bitrate
                )

            if (
                actual_min_bitrate is not None
                and actual_max_bitrate is not None
                and actual_min_bitrate > actual_max_bitrate
            ):
                actual_max_bitrate = actual_min_bitrate

            if guideline_target is not None:
                if (
                    actual_min_bitrate is not None
                    and guideline_target < actual_min_bitrate
                ):
                    guideline_target = actual_min_bitrate
                if (
                    actual_max_bitrate is not None
                    and guideline_target > actual_max_bitrate
                ):
                    guideline_target = actual_max_bitrate

            if (
                guideline_rule
                and not recommended_info_set
                and (
                    not limits.max_resolution_height
                    or (
                        limits.max_resolution_height >= guideline_rule["min_height"]
                        and limits.max_resolution_height <= guideline_rule["max_height"]
                    )
                )
            ):
                result["recommended"] = {
                    "resolution": guideline_rule["label"],
                    "fps": guideline_rule["fps"],
                    "min_bitrate_mbps": actual_min_bitrate,
                    "max_bitrate_mbps": actual_max_bitrate,
                    "target_bitrate_mbps": guideline_target,
                }
                recommended_info_set = True

            if (
                limits.max_resolution_height
                and height
                and height > limits.max_resolution_height
            ):
                add_violation(
                    "resolution_exceeded",
                    "Video resolution exceeds your plan limit.",
                    current=f"{height}p",
                    allowed=f"{limits.max_resolution_height}p",
                )

            if limits.max_fps and fps and fps > limits.max_fps:
                add_violation(
                    "fps_exceeded",
                    "Frame rate exceeds the allowed value.",
                    current=f"{fps:.2f} FPS",
                    allowed=f"{limits.max_fps} FPS",
                )

            if fps is None:
                add_violation(
                    "fps_out_of_range",
                    "Frame rate could not be detected. Encode the video using the recommended frame rate.",
                    current=None,
                    allowed=(
                        f"{guideline_rule['fps']} FPS"
                        if guideline_rule
                        else f"{limits.max_fps or 30} FPS"
                    ),
                )
            elif fps_bucket and limits.max_fps and fps_bucket > limits.max_fps:
                add_violation(
                    "fps_out_of_range",
                    "Frame rate exceeds the allowed value.",
                    current=f"{fps:.2f} FPS",
                    allowed=f"{limits.max_fps} FPS",
                )
            elif fps_bucket is not None and fps_out_of_guideline:
                add_violation(
                    "fps_out_of_range",
                    "Frame rate must match YouTube guidance.",
                    current=f"{fps:.2f} FPS",
                    allowed=(
                        f"{guideline_rule['fps']} FPS"
                        if guideline_rule
                        else f"{limits.max_fps or 30} FPS"
                    ),
                )

            if not guideline_rule:
                add_violation(
                    "guideline_missing",
                    "No quality guideline found for this resolution within your plan.",
                    current=f"{height}p" if height else None,
                    allowed=(
                        f"{limits.max_resolution_height}p @ {limits.max_fps or 30} FPS"
                        if limits.max_resolution_height
                        else "1080p @ 30 FPS"
                    ),
                )

            if bitrate_mbps is None:
                add_violation(
                    "bitrate_missing",
                    "Bitrate metadata is missing. Revalidate or re-encode the file.",
                )
            else:
                min_allowed = actual_min_bitrate
                max_allowed = actual_max_bitrate

                if min_allowed is not None or max_allowed is not None:
                    out_of_range = False
                    if min_allowed is not None and bitrate_mbps < min_allowed:
                        out_of_range = True
                    if max_allowed is not None and bitrate_mbps > max_allowed:
                        out_of_range = True

                    if out_of_range:
                        target_text = None
                        if (
                            guideline_rule
                            and guideline_rule.get("target_bitrate_mbps") is not None
                        ):
                            target_text = (
                                f"{guideline_rule['target_bitrate_mbps']} Mbps"
                            )

                        if target_text:
                            allowed_text = target_text
                        elif min_allowed is not None and max_allowed is not None:
                            allowed_text = f"{min_allowed}–{max_allowed} Mbps"
                        elif min_allowed is not None:
                            allowed_text = f"≥ {min_allowed} Mbps"
                        elif max_allowed is not None:
                            allowed_text = f"≤ {max_allowed} Mbps"
                        else:
                            allowed_text = "recommended range"

                        add_violation(
                            "bitrate_out_of_range",
                            "Video bitrate must stay within the recommended range.",
                            current=_format_bitrate(bitrate_mbps),
                            allowed=allowed_text,
                        )

                if tier_min_bitrate is not None and bitrate_mbps < tier_min_bitrate:
                    add_violation(
                        "bitrate_out_of_range",
                        "Video bitrate is below your plan's minimum.",
                        current=_format_bitrate(bitrate_mbps),
                        allowed=f"≥ {tier_min_bitrate} Mbps",
                    )

                if tier_max_bitrate is not None and bitrate_mbps > tier_max_bitrate:
                    add_violation(
                        "bitrate_out_of_range",
                        "Video bitrate exceeds the allowed value.",
                        current=_format_bitrate(bitrate_mbps),
                        allowed=f"≤ {tier_max_bitrate} Mbps",
                    )

        if audio_assets:
            expected_codec_label = AUDIO_QUALITY_GUIDANCE["codec_label"]

            for index, asset in enumerate(audio_assets):
                meta = asset.get("meta") or {}
                audio = meta.get("audio") or {}
                label = (
                    asset.get("filename")
                    or asset.get("asset_id")
                    or f"audio #{index + 1}"
                )

                def add_audio_violation(
                    code: str, message: str, *, current: Any = None, allowed: Any = None
                ):
                    result["violations"].append(
                        {
                            "code": code,
                            "message": message,
                            "asset_id": asset.get("asset_id"),
                            "filename": label,
                            "position": len(video_assets) + index,
                            "current": current,
                            "allowed": allowed,
                        }
                    )

                def _format_codec(name: str) -> str:
                    normalized = (name or "").lower()
                    if normalized in {"mp3", "mpga"}:
                        return "MP3"
                    if normalized in {"aac", "mp4a"}:
                        return "AAC"
                    return (name or "").upper()

                if not audio:
                    add_audio_violation(
                        "audio_metadata_missing",
                        "Audio metadata is missing. Revalidate the file before streaming.",
                    )
                    continue

                codec_name = (
                    audio.get("codec_name") or audio.get("codec") or ""
                ).lower()
                if codec_name and codec_name not in SUPPORTED_AUDIO_CODECS:
                    add_audio_violation(
                        "audio_codec_not_allowed",
                        "Audio codec is not supported for live streaming.",
                        current=_format_codec(codec_name),
                        allowed=expected_codec_label,
                    )

                sample_rate = _safe_int(
                    audio.get("sample_rate")
                    or audio.get("sampleRate")
                    or audio.get("sample_rate_hz")
                    or audio.get("sampleRateHz")
                )
                if sample_rate and sample_rate < MIN_AUDIO_SAMPLE_RATE_HZ:
                    add_audio_violation(
                        "audio_sample_rate_low",
                        "Audio sample rate is below the recommended value.",
                        current=f"{sample_rate} Hz",
                        allowed=f"≥ {MIN_AUDIO_SAMPLE_RATE_HZ} Hz",
                    )

                bitrate_bps = _safe_float(audio.get("bitrate") or meta.get("bitrate"))
                if bitrate_bps is not None:
                    bitrate_kbps = bitrate_bps / 1_000
                    if bitrate_kbps < AUDIO_QUALITY_GUIDANCE["min_bitrate_kbps"]:
                        add_audio_violation(
                            "audio_bitrate_out_of_range",
                            "Audio bitrate is below the recommended range.",
                            current=f"{int(bitrate_kbps)} kbps",
                            allowed=f"≥ {AUDIO_QUALITY_GUIDANCE['min_bitrate_kbps']} kbps",
                        )
                else:
                    add_audio_violation(
                        "audio_metadata_missing",
                        "Audio bitrate metadata is missing. Revalidate the file before streaming.",
                    )

                channels = _safe_int(audio.get("channels"))
                if channels and channels > AUDIO_QUALITY_GUIDANCE["channels"] + 2:
                    add_audio_violation(
                        "audio_channels_high",
                        "Audio channel count may not be supported by YouTube.",
                        current=str(channels),
                        allowed=str(AUDIO_QUALITY_GUIDANCE["channels"]),
                    )

        if result["violations"]:
            result["ok"] = False
            if "recommended" not in result and has_video:
                fallback_rule = None
                if limits.max_resolution_height:
                    fallback_rule = next(
                        (
                            entry
                            for entry in guidance_table
                            if entry["max_height"] == limits.max_resolution_height
                            and (not limits.max_fps or entry["fps"] == limits.max_fps)
                        ),
                        None,
                    )

                result["recommended"] = {
                    "resolution": (
                        fallback_rule["label"]
                        if fallback_rule
                        else (
                            f"{limits.max_resolution_height}p"
                            if limits.max_resolution_height
                            else None
                        )
                    ),
                    "fps": fallback_rule["fps"] if fallback_rule else limits.max_fps,
                    "min_bitrate_mbps": (
                        fallback_rule.get("min_bitrate_mbps")
                        if fallback_rule
                        else limits.min_video_bitrate_mbps
                    ),
                    "max_bitrate_mbps": (
                        fallback_rule.get("max_bitrate_mbps")
                        if fallback_rule
                        else limits.max_video_bitrate_mbps
                    ),
                    "target_bitrate_mbps": (
                        fallback_rule.get("target_bitrate_mbps")
                        if fallback_rule
                        else None
                    ),
                    "video_codec": (
                        fallback_rule.get("video_codec") if fallback_rule else "H.264"
                    ),
                    "audio_codec": (
                        fallback_rule.get("audio_codec") if fallback_rule else "AAC"
                    ),
                    "protocol": (
                        fallback_rule.get("protocol") if fallback_rule else "RTMP/RTMPS"
                    ),
                    "keyframe_interval_seconds": (
                        fallback_rule.get("keyframe_interval_seconds")
                        if fallback_rule
                        else 2
                    ),
                }

        return result

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

        result = await self.db.execute(
            select(func.count(Playlist.id)).where(Playlist.user_id == self.user_id)
        )
        count = result.scalar()

        limit = self._limits.max_playlists

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
                tier=self._profile.subscription_tier,
            )

        return True

    async def check_destinations_limit(self) -> bool:
        """
        Check if user can create another destination.

        Returns:
            bool: True if allowed

        Raises:
            QuotaExceededError: If limit reached
        """
        await self.check_suspended()
        await self._load_limits()

        result = await self.db.execute(
            select(func.count(Destination.id)).where(
                Destination.user_id == self.user_id
            )
        )
        count = result.scalar()

        limit = self._limits.max_destinations

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
                tier=self._profile.subscription_tier,
            )

        return True

    async def check_storage_limit(self, additional_bytes: int = 0) -> bool:
        """
        Check if user has enough storage quota.

        Args:
            additional_bytes: Additional bytes to check

        Returns:
            bool: True if allowed

        Raises:
            QuotaExceededError: If limit reached
        """
        await self.check_suspended()
        await self._load_limits()

        current_bytes = self._profile.current_storage_bytes or 0
        limit_bytes = (
            self._limits.storage_gb * 1024**3
            if self._limits.storage_gb
            else float("inf")
        )

        if current_bytes + additional_bytes > limit_bytes:
            used_gb = current_bytes / (1024**3)

            await self._create_alert(
                "quota_exceeded",
                f"Storage quota exceeded: {used_gb:.2f}/{self._limits.storage_gb} GB",
                {
                    "resource": "storage",
                    "used_gb": used_gb,
                    "limit_gb": self._limits.storage_gb,
                },
            )

            raise QuotaExceededError(
                resource="storage",
                current=round(used_gb, 2),
                limit=self._limits.storage_gb,
                tier=self._profile.subscription_tier,
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


def require_quota(check_func: str):
    """
    Decorator for endpoints that require quota checks.

    Usage:
        @router.post("/streams")
        @require_quota("check_concurrent_streams")
        async def create_stream(...):
            ...

    Args:
        check_func: Name of the QuotaEnforcer method to call
    """

    def decorator(endpoint: Callable):
        @wraps(endpoint)
        async def wrapper(*args, **kwargs):
            # Extract db and user_id from user_deps parameter
            user_deps = kwargs.get("user_deps")
            if not user_deps:
                # Try to find it in args
                for arg in args:
                    if isinstance(arg, tuple) and len(arg) == 2:
                        user_deps = arg
                        break

            if not user_deps:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Internal error: user_deps not found",
                )

            db, user_id = user_deps

            # Create enforcer and check quota
            enforcer = QuotaEnforcer(db, user_id)
            check_method = getattr(enforcer, check_func)
            await check_method()

            # Call original endpoint
            return await endpoint(*args, **kwargs)

        return wrapper

    return decorator
