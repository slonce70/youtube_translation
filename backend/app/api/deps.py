import asyncio
import logging
from collections import OrderedDict
from datetime import datetime, timedelta
from threading import RLock
from typing import Optional, Tuple
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Header, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.database import UserProfile
from supabase import Client, create_client

logger = logging.getLogger(__name__)

# Supabase client
supabase: Client = create_client(settings.supabase_url, settings.supabase_key)

# Token → (user_payload, cache_expiration)
_UserCacheEntry = Tuple[dict, datetime]
_user_cache: OrderedDict[str, _UserCacheEntry] = OrderedDict()
_cache_lock = RLock()


def _cache_enabled() -> bool:
    return (
        settings.supabase_user_cache_ttl_seconds > 0
        and settings.supabase_user_cache_max_entries > 0
    )


def _get_cached_user(token: str) -> Optional[dict]:
    if not _cache_enabled():
        return None

    now = datetime.utcnow()
    with _cache_lock:
        entry = _user_cache.get(token)
        if not entry:
            return None

        user_payload, expiry = entry
        if expiry <= now:
            _user_cache.pop(token, None)
            return None

        # LRU: move to end to mark as recently used
        _user_cache.move_to_end(token)
        return dict(user_payload)


def _prune_cache_locked() -> None:
    max_entries = settings.supabase_user_cache_max_entries
    while len(_user_cache) > max_entries > 0:
        _user_cache.popitem(last=False)


def _set_cached_user(token: str, payload: dict, exp: Optional[int]) -> None:
    if not _cache_enabled():
        return

    ttl_seconds = max(settings.supabase_user_cache_ttl_seconds, 0)
    if ttl_seconds == 0:
        return

    now = datetime.utcnow()
    expiry_candidates = [now + timedelta(seconds=ttl_seconds)]

    if isinstance(exp, (int, float)):
        try:
            expiry_candidates.append(datetime.utcfromtimestamp(exp))
        except (ValueError, OSError):
            logger.debug("Invalid exp claim while caching Supabase user; ignoring exp override")

    expiry = min(expiry_candidates)
    leeway = max(settings.supabase_user_cache_expiry_leeway_seconds, 0)
    if leeway:
        expiry -= timedelta(seconds=leeway)

    if expiry <= now:
        # Token is about to expire; skip caching
        return

    with _cache_lock:
        _user_cache[token] = (dict(payload), expiry)
        _user_cache.move_to_end(token)
        _prune_cache_locked()


def clear_user_cache() -> None:
    """Clear cached Supabase user entries (primarily for tests)."""
    with _cache_lock:
        _user_cache.clear()


async def _fetch_supabase_user(token: str):
    """Fetch user details from Supabase auth in a thread to avoid blocking."""
    return await asyncio.to_thread(supabase.auth.get_user, token)


async def get_current_user(
    authorization: Optional[str] = Header(None)
) -> dict:
    """
    Get current user from Supabase JWT token with expiration check.
    
    Args:
        authorization: Bearer token from Authorization header
        
    Returns:
        User dict with 'sub' (user_id) and other user info
        
    Raises:
        HTTPException: If token is invalid or missing
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = authorization.replace("Bearer ", "")
    
    try:
        # First, decode and verify JWT locally with expiration check
        try:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=[settings.algorithm],
                options={
                    "verify_signature": True, 
                    "verify_exp": True,
                    "verify_aud": False  # Supabase tokens don't require audience validation
                }
            )
            
            # Check expiration manually as well
            exp = payload.get("exp")
            if exp and datetime.utcfromtimestamp(exp) < datetime.utcnow():
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token has expired",
                    headers={"WWW-Authenticate": "Bearer"},
                )
                
        except jwt.ExpiredSignatureError:
            logger.warning("Expired JWT token attempt")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has expired",
                headers={"WWW-Authenticate": "Bearer"},
            )
        except jwt.InvalidTokenError as e:
            logger.warning(f"Invalid JWT token: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        cached_user = _get_cached_user(token)
        if cached_user:
            return cached_user

        # Then verify with Supabase
        user = await _fetch_supabase_user(token)

        if not user or not user.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user_payload = {
            "sub": user.user.id,
            "email": user.user.email,
            "user_metadata": user.user.user_metadata,
            "exp": exp
        }

        _set_cached_user(token, user_payload, exp)

        # Return user dict with 'sub' for user_id (standard JWT claim)
        return user_payload
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error verifying token: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def _ensure_user_profile(db: AsyncSession, user_payload: dict) -> UUID:
    """Создаёт профиль пользователя в БД, если его ещё нет."""

    raw_id = user_payload.get("sub")
    if not raw_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User ID missing in token",
        )

    try:
        user_id = UUID(str(raw_id))
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user identifier in token",
        )

    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()

    email = user_payload.get("email")
    metadata = user_payload.get("user_metadata") or {}
    full_name = metadata.get("full_name") or metadata.get("name")

    if profile:
        updated = False
        if email and profile.email != email:
            profile.email = email
            updated = True
        if full_name and profile.full_name != full_name:
            profile.full_name = full_name
            updated = True

        if updated:
            await db.commit()

        return profile.user_id

    # Профиль отсутствует — создаём с минимально необходимыми полями
    if not email:
        email = f"user-{user_id}@example.invalid"

    new_profile = UserProfile(
        user_id=user_id,
        email=email,
        full_name=full_name,
        subscription_tier="free",
        subscription_status="active",
    )

    db.add(new_profile)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return new_profile.user_id


async def get_current_user_id(
    authorization: Optional[str] = Header(None)
) -> str:
    """
    Get current user ID from Supabase JWT token.
    
    Args:
        authorization: Bearer token from Authorization header
        
    Returns:
        User ID (UUID string)
        
    Raises:
        HTTPException: If token is invalid or missing
    """
    user = await get_current_user(authorization)
    return user["sub"]


async def get_current_user_optional(
    authorization: Optional[str] = Header(None)
) -> Optional[str]:
    """
    Get current user ID if authenticated, None otherwise.
    For optional authentication endpoints.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    
    try:
        return await get_current_user_id(authorization)
    except HTTPException:
        return None


class UserDependency:
    """Dependency class for getting current user with database session"""
    
    def __init__(self, required: bool = True):
        self.required = required
    
    async def __call__(
        self,
        db: AsyncSession = Depends(get_db),
        authorization: Optional[str] = Header(None)
    ) -> tuple[AsyncSession, Optional[str]]:
        """
        Get database session and current user ID.
        
        Returns:
            Tuple of (db_session, user_id)
        """
        user_payload: Optional[dict] = None

        if self.required:
            user_payload = await get_current_user(authorization)
        elif authorization and authorization.startswith("Bearer "):
            try:
                user_payload = await get_current_user(authorization)
            except HTTPException:
                user_payload = None

        user_id: Optional[str] = None
        if user_payload:
            ensured_id = await _ensure_user_profile(db, user_payload)
            user_id = str(ensured_id)

        return db, user_id


# Dependency instances
require_user = UserDependency(required=True)
optional_user = UserDependency(required=False)
