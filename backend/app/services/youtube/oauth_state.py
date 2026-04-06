from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urljoin, urlparse
from uuid import UUID

import jwt

from app.core.config import settings


class YoutubeOAuthStateError(RuntimeError):
    """Raised when the signed OAuth state is invalid."""


_STATE_SECRET_FALLBACK = settings.encryption_key


def _state_secret() -> str:
    return settings.youtube_oauth_state_secret or _STATE_SECRET_FALLBACK


def create_oauth_state(
    *, user_id: UUID, redirect_origin: str, redirect_path: str
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "redirect_origin": normalize_redirect_origin(redirect_origin),
        "redirect_path": normalize_redirect_path(redirect_path),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=15)).timestamp()),
    }
    return jwt.encode(payload, _state_secret(), algorithm=settings.algorithm)


def parse_oauth_state(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, _state_secret(), algorithms=[settings.algorithm])
    except jwt.PyJWTError as exc:
        raise YoutubeOAuthStateError("Invalid YouTube OAuth state") from exc
    payload["redirect_origin"] = normalize_redirect_origin(payload["redirect_origin"])
    payload["redirect_path"] = normalize_redirect_path(payload["redirect_path"])
    return payload


def normalize_redirect_origin(origin: str) -> str:
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise YoutubeOAuthStateError("Invalid redirect origin")
    return f"{parsed.scheme}://{parsed.netloc}"


def normalize_redirect_path(path: str) -> str:
    parsed = urlparse(path or "/dashboard/profile")
    clean_path = parsed.path or "/dashboard/profile"
    if not clean_path.startswith("/"):
        clean_path = f"/{clean_path}"
    if parsed.scheme or parsed.netloc:
        raise YoutubeOAuthStateError("Invalid redirect path")
    suffix = f"?{parsed.query}" if parsed.query else ""
    return f"{clean_path}{suffix}"


def build_redirect_url(
    origin: str, path: str, *, status: str, message: str | None = None
) -> str:
    from urllib.parse import urlencode

    base = urljoin(normalize_redirect_origin(origin), normalize_redirect_path(path))
    params = {"youtube_oauth": status}
    if message:
        params["youtube_message"] = message
    joiner = "&" if "?" in base else "?"
    return f"{base}{joiner}{urlencode(params)}"
