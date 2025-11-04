"""
Quota Enforcement Module

Middleware and decorators for enforcing subscription tier limits
across all API operations.
"""

from functools import wraps
from typing import Optional, Callable
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import logging
from urllib.parse import urlparse

from app.models.database import (
    UserProfile, SubscriptionTierLimits,
    Asset, Playlist, Destination, Stream, SystemAlert
)

logger = logging.getLogger(__name__)


class QuotaExceededError(HTTPException):
    """Custom exception for quota exceeded errors"""
    
    def __init__(self, resource: str, current: int, limit: int, tier: str, upgrade_required: bool = True):
        detail = {
            "error": "quota_exceeded",
            "resource": resource,
            "current": current,
            "limit": limit,
            "tier": tier,
            "upgrade_required": upgrade_required,
            "message": f"{resource.title()} limit reached ({current}/{limit}). "
                      f"Upgrade your plan to create more {resource}."
        }
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=detail
        )


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
                    detail="User profile not found"
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
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Invalid subscription tier: {self._profile.subscription_tier}"
                )
    
    async def check_suspended(self):
        """Check if user is suspended"""
        await self._load_profile()
        
        if self._profile.is_suspended:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "account_suspended",
                    "reason": self._profile.suspension_reason or "Account suspended. Contact support.",
                    "contact": "support@yourplatform.com"
                }
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
                Stream.status.in_(['running', 'starting'])
            )
        )
        active_count = result.scalar()
        
        limit = self._limits.max_concurrent_streams
        
        if limit is not None and active_count >= limit:
            # Create system alert
            await self._create_alert(
                'quota_exceeded',
                f'Concurrent streams quota exceeded: {active_count}/{limit}',
                {'resource': 'streams', 'count': active_count, 'limit': limit}
            )
            
            raise QuotaExceededError(
                resource="concurrent streams",
                current=active_count,
                limit=limit,
                tier=self._profile.subscription_tier
            )
        
        return True
    
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
                'quota_exceeded',
                f'Assets quota exceeded: {count}/{limit}',
                {'resource': 'assets', 'count': count, 'limit': limit}
            )
            
            raise QuotaExceededError(
                resource="assets",
                current=count,
                limit=limit,
                tier=self._profile.subscription_tier
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
                }
            )

        hostname = parsed.hostname or ""
        if not hostname:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "invalid_destination",
                    "message": "Destination URL must include a hostname",
                }
            )

        if not self._limits.custom_rtmps_enabled:
            if not hostname.endswith("rtmp.youtube.com"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "error": "custom_rtmps_not_allowed",
                        "message": "Your plan does not allow custom RTMPS destinations",
                        "tier": self._profile.subscription_tier,
                    }
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
        
        result = await self.db.execute(
            select(func.count(Playlist.id)).where(Playlist.user_id == self.user_id)
        )
        count = result.scalar()
        
        limit = self._limits.max_playlists
        
        if limit is not None and count >= limit:
            await self._create_alert(
                'quota_exceeded',
                f'Playlists quota exceeded: {count}/{limit}',
                {'resource': 'playlists', 'count': count, 'limit': limit}
            )
            
            raise QuotaExceededError(
                resource="playlists",
                current=count,
                limit=limit,
                tier=self._profile.subscription_tier
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
            select(func.count(Destination.id)).where(Destination.user_id == self.user_id)
        )
        count = result.scalar()
        
        limit = self._limits.max_destinations
        
        if limit is not None and count >= limit:
            await self._create_alert(
                'quota_exceeded',
                f'Destinations quota exceeded: {count}/{limit}',
                {'resource': 'destinations', 'count': count, 'limit': limit}
            )
            
            raise QuotaExceededError(
                resource="destinations",
                current=count,
                limit=limit,
                tier=self._profile.subscription_tier
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
        limit_bytes = self._limits.storage_gb * 1024**3 if self._limits.storage_gb else float('inf')
        
        if current_bytes + additional_bytes > limit_bytes:
            used_gb = current_bytes / (1024**3)
            
            await self._create_alert(
                'quota_exceeded',
                f'Storage quota exceeded: {used_gb:.2f}/{self._limits.storage_gb} GB',
                {'resource': 'storage', 'used_gb': used_gb, 'limit_gb': self._limits.storage_gb}
            )
            
            raise QuotaExceededError(
                resource="storage",
                current=round(used_gb, 2),
                limit=self._limits.storage_gb,
                tier=self._profile.subscription_tier
            )
        
        return True
    
    async def _create_alert(self, alert_type: str, message: str, details: dict):
        """Create a system alert for quota exceeded"""
        try:
            alert = SystemAlert(
                user_id=self.user_id,
                alert_type=alert_type,
                severity='warning',
                message=message,
                details=details,
                resolved=False
            )
            self.db.add(alert)
            await self.db.flush()
            
            logger.warning(f"Quota exceeded alert created for user {self.user_id}: {message}")
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
            user_deps = kwargs.get('user_deps')
            if not user_deps:
                # Try to find it in args
                for arg in args:
                    if isinstance(arg, tuple) and len(arg) == 2:
                        user_deps = arg
                        break
            
            if not user_deps:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Internal error: user_deps not found"
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
