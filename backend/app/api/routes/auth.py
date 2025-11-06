import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from supabase import (
    AuthApiError,
    AuthInvalidCredentialsError,
    ClientOptions,
    create_client,
)
import httpx

from app.api.deps import get_current_user, invalidate_cached_user
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


def _create_supabase_client():
    """Create a short-lived Supabase client without persisted session state."""
    options = ClientOptions(
        persist_session=False,
        auto_refresh_token=False,
    )
    return create_client(settings.supabase_url, settings.supabase_key, options)


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    expires_in: Optional[int] = None


class CurrentUserResponse(BaseModel):
    id: str
    email: Optional[str] = None
    user_metadata: dict = Field(default_factory=dict)


@router.post("/login", response_model=TokenResponse)
async def login(credentials: LoginRequest):
    """Login with email/password via Supabase"""
    client = _create_supabase_client()

    try:
        auth_response = await asyncio.to_thread(
            client.auth.sign_in_with_password,
            {"email": credentials.email, "password": credentials.password},
        )
    except (AuthInvalidCredentialsError, AuthApiError):
        logger.warning("Invalid Supabase credentials for %s", credentials.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    except Exception as exc:
        logger.exception("Supabase authentication failure: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to authenticate user",
        )

    session = getattr(auth_response, "session", None)
    if not session or not getattr(session, "access_token", None):
        logger.error("Supabase returned empty session for %s", credentials.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token_type = getattr(session, "token_type", None) or "bearer"
    refresh_token = getattr(session, "refresh_token", None)
    expires_in = getattr(session, "expires_in", None)

    return TokenResponse(
        access_token=session.access_token,
        token_type=token_type.lower(),
        refresh_token=refresh_token,
        expires_in=expires_in,
    )


@router.post("/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Logout user"""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )

    admin_revoked = False
    try:
        client = _create_supabase_client()
        await asyncio.to_thread(client.auth.admin.sign_out, token, "global")
        admin_revoked = True
    except Exception as exc:  # pragma: no cover - defensive safeguard
        logger.warning("Supabase admin sign_out failed: %s", exc)

    if not admin_revoked:
        logout_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/logout"

        try:
            async with httpx.AsyncClient(timeout=5) as http_client:
                response = await http_client.post(
                    logout_url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "apikey": settings.supabase_key,
                    },
                )
        except httpx.HTTPError as exc:
            logger.exception("Network error during Supabase logout: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Supabase logout service unavailable",
            )

        if response.status_code >= 500:
            logger.error(
                "Supabase logout returned %s: %s",
                response.status_code,
                response.text,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Supabase logout service unavailable",
            )

        if response.status_code >= 400:
            logger.warning(
                "Supabase logout failed with status %s: %s",
                response.status_code,
                response.text,
            )

    invalidate_cached_user(token)

    return {"message": "Logged out successfully"}


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_user_info(user: dict = Depends(get_current_user)):
    """Get current user info"""
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User ID not found in token",
        )

    return CurrentUserResponse(
        id=user_id,
        email=user.get("email"),
        user_metadata=user.get("user_metadata") or {},
    )
