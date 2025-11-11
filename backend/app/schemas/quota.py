"""Schemas shared between quota routes and services."""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class QuotaCheckRequest(BaseModel):
    """Incoming payload from tusd pre-create hook."""

    user_id: UUID
    file_size: int


class QuotaCheckResponse(BaseModel):
    """Result of a quota check attempt."""

    can_upload: bool
    reason: Optional[str] = None
    current_usage: Optional[dict] = None


class QuotaUsageResponse(BaseModel):
    """Aggregated quota usage for an authenticated user."""

    storage: dict
    streams: dict
    destinations: dict
    playlists: dict
    assets: dict
    streaming_hours: dict
    quality: dict
    tier: str


__all__ = [
    "QuotaCheckRequest",
    "QuotaCheckResponse",
    "QuotaUsageResponse",
]
