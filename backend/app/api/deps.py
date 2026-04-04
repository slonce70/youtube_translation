import asyncio
import logging
import re
import secrets
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Any, Optional, Tuple, cast
from uuid import UUID, uuid5, NAMESPACE_DNS

import httpx
import jwt
from fastapi import Depends, HTTPException, Header, status
from gotrue.errors import AuthRetryableError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.database import UserProfile
from supabase import Client, create_client

logger = logging.getLogger(__name__)

# Supabase client
supabase_auth_key = settings.supabase_service_key or settings.supabase_key
supabase: Optional[Client] = None

if settings.supabase_url and supabase_auth_key:
    try:
        supabase = create_client(settings.supabase_url, supabase_auth_key)
    except Exception as exc:
        if settings.enable_dev_auth:
            logger.warning(
                "Supabase init failed, continuing with dev auth enabled",
                exc_info=exc,
            )
        elif settings.environment in {"development", "test"}:
            logger.warning(
                "Supabase init failed in %s environment; deferring auth failures to request time",
                settings.environment,
                exc_info=exc,
            )
        else:
            raise
elif settings.enable_dev_auth:
    logger.warning("Supabase credentials missing; dev auth enabled")
else:
    raise RuntimeError("Supabase credentials are not configured")

_SUPABASE_AUTH_MAX_ATTEMPTS = 4
_SUPABASE_AUTH_INITIAL_BACKOFF_SECONDS = 0.25

# Token → (user_payload, cache_expiration)
_UserCacheEntry = Tuple[dict, datetime]
_user_cache: OrderedDict[str, _UserCacheEntry] = OrderedDict()
_cache_lock = RLock()
_dev_user_cache: Optional[dict] = None


def _cache_enabled() -> bool:
    return (
        settings.supabase_user_cache_ttl_seconds > 0
        and settings.supabase_user_cache_max_entries > 0
    )


def _get_cached_user(token: str) -> Optional[dict]:
    if not _cache_enabled():
        return None

    now = datetime.now(timezone.utc)
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

    now = datetime.now(timezone.utc)
    expiry_candidates = [now + timedelta(seconds=ttl_seconds)]

    if isinstance(exp, (int, float)):
        try:
            expiry_candidates.append(datetime.fromtimestamp(exp, tz=timezone.utc))
        except (ValueError, OSError):
            logger.debug(
                "Invalid exp claim while caching Supabase user; ignoring exp override"
            )

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


def invalidate_cached_user(token: Optional[str]) -> None:
    """Remove a single cached Supabase user entry."""
    if not token or not _cache_enabled():
        return

    with _cache_lock:
        _user_cache.pop(token, None)


async def _fetch_supabase_user(token: str):
    """Fetch user details from Supabase auth with retry handling for transient errors."""
    if supabase is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase auth is not configured",
        )

    delay = _SUPABASE_AUTH_INITIAL_BACKOFF_SECONDS
    last_error: Optional[Exception] = None

    for attempt in range(1, _SUPABASE_AUTH_MAX_ATTEMPTS + 1):
        try:
            return await asyncio.to_thread(supabase.auth.get_user, token)
        except AuthRetryableError as exc:  # Supabase transient error
            last_error = exc
            logger.warning(
                "Supabase auth request attempt %s/%s failed with retryable error: %s",
                attempt,
                _SUPABASE_AUTH_MAX_ATTEMPTS,
                exc,
            )
        except httpx.TransportError as exc:
            last_error = exc
            logger.warning(
                "Supabase auth request attempt %s/%s failed due to transport error: %s",
                attempt,
                _SUPABASE_AUTH_MAX_ATTEMPTS,
                exc,
            )
        except (
            Exception
        ) as exc:  # pragma: no cover - unexpected errors bubble immediately
            logger.error(
                "Supabase auth request failed with unexpected error", exc_info=exc
            )
            raise

        if attempt < _SUPABASE_AUTH_MAX_ATTEMPTS:
            await asyncio.sleep(delay)
            delay = min(delay * 2, 2.0)

    assert last_error is not None  # for mypy
    raise last_error


def _dev_user_payload() -> Optional[dict]:
    if not settings.enable_dev_auth:
        return None

    email = settings.dev_user_email or "dev@example.com"
    raw_user_id = settings.dev_user_id

    try:
        user_uuid = (
            UUID(str(raw_user_id)) if raw_user_id else uuid5(NAMESPACE_DNS, email)
        )
    except (ValueError, TypeError):
        user_uuid = uuid5(NAMESPACE_DNS, email)

    payload = {
        "sub": str(user_uuid),
        "email": email,
        "user_metadata": {"dev_mode": True},
        "exp": None,
    }
    return payload


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    Get current user from Supabase JWT token with expiration check.

    Args:
        authorization: Bearer token from Authorization header

    Returns:
        User dict with 'sub' (user_id) and other user info

    Raises:
        HTTPException: If token is invalid or missing
    """
    if settings.enable_dev_auth and supabase is None:
        dev_payload = _dev_user_payload()
        if dev_payload:
            logger.info("Using dev auth fallback for %s", dev_payload["email"])
            return dev_payload

    if not authorization:
        dev_payload = _dev_user_payload()
        if dev_payload:
            logger.info("Using dev auth fallback for %s", dev_payload["email"])
            return dev_payload

        logger.debug("Auth request without Authorization header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not authorization.startswith("Bearer "):
        logger.debug(
            "Auth request with invalid Authorization header format: %s",
            authorization[:20],
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format",
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
                    "verify_aud": False,
                },
            )

            exp = payload.get("exp")
            if exp and datetime.fromtimestamp(exp, tz=timezone.utc) < datetime.now(
                timezone.utc
            ):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token has expired",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        except jwt.ExpiredSignatureError:
            logger.info("Rejected expired JWT token")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has expired",
                headers={"WWW-Authenticate": "Bearer"},
            )
        except jwt.InvalidTokenError as e:
            if settings.environment != "development":
                logger.info("Rejected invalid JWT token: %s", str(e)[:100])
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid token",
                    headers={"WWW-Authenticate": "Bearer"},
                )

            logger.debug(
                "JWT decode failed locally in development; falling back to Supabase validation: %s",
                e,
            )
            payload = {}
            exp = None

        cached_user = _get_cached_user(token)
        if cached_user:
            return cached_user

        # Then verify with Supabase
        user = await _fetch_supabase_user(token)

        if not user or not user.user:
            logger.info("Supabase rejected token: user not found or session invalid")
            dev_payload = _dev_user_payload()
            if dev_payload:
                logger.warning(
                    "Falling back to dev auth payload after Supabase rejection"
                )
                return dev_payload
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user_payload = {
            "sub": user.user.id,
            "email": user.user.email,
            "user_metadata": user.user.user_metadata,
            "exp": exp,
        }

        _set_cached_user(token, user_payload, exp)

        # Return user dict with 'sub' for user_id (standard JWT claim)
        return user_payload

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error verifying token: {e}")
        dev_payload = _dev_user_payload()
        if dev_payload:
            logger.warning("Dev auth fallback engaged after verification error")
            return dev_payload
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def _ensure_user_profile(
    db: AsyncSession,
    user_payload: dict,
    client_timezone: Optional[str] = None,
) -> UUID:
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

    dev_payload = _dev_user_payload()
    is_configured_dev_user = (
        dev_payload is not None
        and str(user_id) == str(dev_payload.get("sub"))
        and user_payload.get("email") == dev_payload.get("email")
    )

    result = await db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    profile = result.scalar_one_or_none()

    email = user_payload.get("email")
    metadata = user_payload.get("user_metadata") or {}
    full_name = metadata.get("full_name") or metadata.get("name")
    # Optional timezone passed from client (IANA format, e.g. Europe/Kyiv)
    user_timezone = (
        client_timezone.strip() if isinstance(client_timezone, str) else None
    )
    if user_timezone:
        timezone_pattern = r"[A-Za-z0-9_+\\/\\-]+"
        if len(user_timezone) > 64 or not re.fullmatch(timezone_pattern, user_timezone):
            user_timezone = None

    if profile is None and email:
        existing_by_email = await db.execute(
            select(UserProfile.user_id).where(UserProfile.email == email)
        )
        conflicting_user_id = existing_by_email.scalar_one_or_none()
        if conflicting_user_id and conflicting_user_id != user_id:
            logger.warning(
                "Identity conflict while provisioning profile: token sub=%s attempted to claim email %s owned by %s",
                user_id,
                email,
                conflicting_user_id,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Authentication identity conflict",
            )

    if profile:
        updated = False
        if email and profile.email != email:
            existing_by_email = await db.execute(
                select(UserProfile.user_id).where(
                    UserProfile.email == email,
                    UserProfile.user_id != user_id,
                )
            )
            conflicting_user_id = existing_by_email.scalar_one_or_none()
            if conflicting_user_id:
                logger.warning(
                    "Identity conflict while updating profile %s: email %s already belongs to %s",
                    user_id,
                    email,
                    conflicting_user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Authentication identity conflict",
                )
            profile.email = email
            updated = True
        if full_name and profile.full_name != full_name:
            profile.full_name = full_name
            updated = True
        if user_timezone and getattr(profile, "timezone", None) != user_timezone:
            cast(Any, profile).timezone = user_timezone
            updated = True
        if is_configured_dev_user and not getattr(profile, "is_admin", False):
            profile.is_admin = True
            updated = True

        if updated:
            await db.commit()

        return user_id

    # Профиль отсутствует — создаём с минимально необходимыми полями
    if not email:
        email = f"user-{user_id}@example.invalid"

    new_profile = UserProfile(
        user_id=user_id,
        email=email,
        full_name=full_name,
        subscription_tier="free",
        subscription_status="active",
        is_admin=is_configured_dev_user,
    )
    if user_timezone:
        cast(Any, new_profile).timezone = user_timezone

    db.add(new_profile)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Параллельный запрос мог создать профиль чуть раньше — пробуем получить его
        existing_result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        existing_profile = existing_result.scalar_one_or_none()
        if existing_profile:
            return user_id
        if email:
            email_owner_result = await db.execute(
                select(UserProfile.user_id).where(UserProfile.email == email)
            )
            conflicting_user_id = email_owner_result.scalar_one_or_none()
            if conflicting_user_id and conflicting_user_id != user_id:
                logger.warning(
                    "Identity conflict after IntegrityError: token sub=%s attempted to claim email %s owned by %s",
                    user_id,
                    email,
                    conflicting_user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Authentication identity conflict",
                )
        # Если профиль всё же отсутствует, пробрасываем ошибку для диагностики
        raise
    except Exception:
        await db.rollback()
        raise

    return user_id


async def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
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
    authorization: Optional[str] = Header(None),
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


async def require_metrics_access(
    authorization: Optional[str] = Header(None),
    metrics_token: Optional[str] = Header(default=None, alias="X-Metrics-Token"),
) -> dict:
    """
    Allow access to metrics endpoints only with a shared metrics token.
    """
    configured_token = settings.metrics_access_token
    authorization_value = authorization if isinstance(authorization, str) else None
    metrics_token_value = metrics_token if isinstance(metrics_token, str) else None

    if not configured_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Metrics access token is not configured",
        )

    if metrics_token_value and secrets.compare_digest(
        metrics_token_value, configured_token
    ):
        return {"token": "metrics"}

    if authorization_value and authorization_value.startswith("Bearer "):
        raw_token = authorization_value.replace("Bearer ", "")
        if secrets.compare_digest(raw_token, configured_token):
            return {"token": "metrics"}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid metrics credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


class UserDependency:
    """Dependency class for getting current user with database session"""

    def __init__(self, required: bool = True):
        self.required = required

    async def __call__(
        self,
        db: AsyncSession = Depends(get_db),
        authorization: Optional[str] = Header(None),
        user_timezone: Optional[str] = Header(default=None, alias="X-User-Timezone"),
    ) -> tuple[AsyncSession, Optional[UUID]]:
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

        user_id: Optional[UUID] = None
        if user_payload:
            user_id = await _ensure_user_profile(db, user_payload, user_timezone)

        return db, user_id


# Dependency instances
require_user = UserDependency(required=True)


async def require_admin(
    user_deps: tuple[AsyncSession, Optional[UUID]] = Depends(require_user),
) -> tuple[AsyncSession, UUID]:
    """Ensure the current user has admin privileges."""

    db, user_id = user_deps

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    result = await db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    profile = result.scalar_one_or_none()

    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found",
        )

    if not getattr(profile, "is_admin", False):
        logger.warning("Non-admin user %s attempted to access admin endpoint", user_id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    return db, user_id


optional_user = UserDependency(required=False)
