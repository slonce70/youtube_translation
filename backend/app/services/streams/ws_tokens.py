"""Utilities for short-lived WebSocket auth tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from uuid import UUID, uuid4

from fastapi import HTTPException, status

from app.core.config import settings


def _ws_secret() -> bytes:
    secret = settings.ws_token_secret or settings.upload_token_secret
    return secret.encode("utf-8")


def _sign_ws_payload(payload: str) -> str:
    return hmac.new(_ws_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def generate_ws_token(user_id: UUID) -> tuple[str, int]:
    expires_at = int(time.time()) + max(settings.ws_token_ttl_seconds, 30)
    nonce = uuid4().hex
    payload = f"{user_id}:{expires_at}:{nonce}"
    signature = _sign_ws_payload(payload)
    token = base64.urlsafe_b64encode(f"{payload}:{signature}".encode("utf-8")).decode("utf-8")
    return token, expires_at


def verify_ws_token(token: str) -> UUID:
    try:
        decoded = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
        try:
            payload, signature = decoded.rsplit(":", 1)
        except ValueError as exc:
            raise ValueError("missing signature") from exc

        parts = payload.split(":")
        if len(parts) != 3:
            raise ValueError("invalid token format")
        user_id_str, expires_at_str, nonce = parts
        if not nonce:
            raise ValueError("invalid token payload")
        expected_signature = _sign_ws_payload(payload)
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("invalid signature")
        expires_at = int(expires_at_str)
        if expires_at < int(time.time()):
            raise ValueError("token expired")
        return UUID(user_id_str)
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired WebSocket token",
        ) from exc
