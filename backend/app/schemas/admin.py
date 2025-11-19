"""Pydantic schemas shared by admin endpoints and services."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserListItem(BaseModel):
    """Summary data shown in admin user lists."""

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: str
    full_name: Optional[str]
    subscription_tier: str
    subscription_status: str
    subscription_started_at: Optional[datetime]
    subscription_expires_at: Optional[datetime]
    is_suspended: bool
    current_storage_bytes: int
    total_stream_hours: float
    created_at: datetime
    last_login_at: Optional[datetime]


class UserDetail(BaseModel):
    """Detailed admin view of a user profile."""

    user_id: UUID
    email: str
    full_name: Optional[str]
    company_name: Optional[str]
    subscription_tier: str
    subscription_status: str
    subscription_started_at: Optional[datetime]
    subscription_expires_at: Optional[datetime]
    is_admin: bool
    is_suspended: bool
    suspension_reason: Optional[str]
    current_storage_bytes: int
    total_stream_hours: float
    created_at: datetime
    updated_at: datetime
    last_login_at: Optional[datetime]

    # Counts
    assets_count: int
    playlists_count: int
    destinations_count: int
    streams_count: int
    active_streams_count: int


class SuspendUserRequest(BaseModel):
    """Request payload for suspending a user."""

    reason: str = Field(..., min_length=1, max_length=500)


class ChangeTierRequest(BaseModel):
    """Request payload for changing a user's subscription tier."""

    new_tier: str = Field(
        ...,
        pattern="^(free|fhd_start|fhd_flow|fhd_boost|uhd_start|uhd_flow|uhd_boost)$",
    )
    reason: Optional[str] = None


class StreamListItem(BaseModel):
    """Row shown in the admin stream list."""

    model_config = ConfigDict(from_attributes=True)

    stream_id: UUID
    user_id: UUID
    user_email: str
    name: str
    status: str
    playlist_id: Optional[UUID]
    source_type: str
    destinations_count: int
    started_at: Optional[datetime]
    created_at: datetime


class AlertListItem(BaseModel):
    """Model for representing alerts shown to admins."""

    alert_id: UUID
    user_id: UUID
    user_email: str
    alert_type: str
    severity: str
    message: str
    resolved: bool
    created_at: datetime
    resolved_at: Optional[datetime]
    resolved_by: Optional[UUID]


class ResolveAlertRequest(BaseModel):
    """Request payload for resolving an alert."""

    resolution_notes: Optional[str] = None


class AdminActionLog(BaseModel):
    """Response model for admin audit log entries."""

    id: UUID
    admin_user_id: UUID
    admin_email: str
    action_type: str
    target_user_id: Optional[UUID]
    target_user_email: Optional[str]
    reason: Optional[str]
    details: dict
    created_at: datetime


class AdminAccessResponse(BaseModel):
    """Response payload for verifying admin access."""

    user_id: UUID
    email: str
    full_name: Optional[str]
    subscription_tier: str
    subscription_status: str
    is_admin: bool
    is_suspended: bool


__all__ = [
    "AdminAccessResponse",
    "AdminActionLog",
    "AlertListItem",
    "ChangeTierRequest",
    "ResolveAlertRequest",
    "StreamListItem",
    "SuspendUserRequest",
    "UserDetail",
    "UserListItem",
]
