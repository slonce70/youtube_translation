"""
Admin API Routes

Endpoints for admin panel: user management, stream monitoring, system alerts.
Only accessible by users with is_admin=True.
"""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_admin
from app.schemas.admin import (
    AdminAccessResponse,
    AdminActionLog,
    AlertListResponse,
    ChangeTierRequest,
    ResolveAlertRequest,
    StreamListResponse,
    SuspendUserRequest,
    UserDetail,
    UserListResponse,
)
from app.services.admin import AdminService

router = APIRouter()


async def get_admin_service(
    admin_deps: tuple = Depends(require_admin),
) -> AdminService:
    """Factory that injects AdminService with the current admin context."""

    db, admin_user_id = admin_deps
    return AdminService(db, admin_user_id)


@router.get("/access", response_model=AdminAccessResponse)
async def get_admin_access(service: AdminService = Depends(get_admin_service)):
    """Return basic admin profile data when access is granted."""

    return await service.get_admin_access()


# ==========================================
# User Management Endpoints
# ==========================================


@router.get("/users", response_model=UserListResponse)
async def list_users(
    tier: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    suspended: Optional[bool] = Query(None),
    is_suspended: Optional[bool] = Query(None, alias="is_suspended"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    service: AdminService = Depends(get_admin_service),
):
    """
    List all users with filters.

    Admin only endpoint.
    """
    suspended_filter = suspended if suspended is not None else is_suspended
    return await service.list_users(
        tier=tier,
        status_filter=status,
        suspended_filter=suspended_filter,
        limit=limit,
        offset=offset,
    )


@router.get("/users/{user_id}", response_model=UserDetail)
async def get_user_detail(
    user_id: UUID,
    service: AdminService = Depends(get_admin_service),
):
    """
    Get detailed information about a user.

    Admin only endpoint.
    """
    return await service.get_user_detail(user_id)


@router.post("/users/{user_id}/suspend")
async def suspend_user(
    user_id: UUID,
    request: SuspendUserRequest,
    service: AdminService = Depends(get_admin_service),
):
    """
    Suspend a user account.

    Admin only endpoint.
    """
    return await service.suspend_user(user_id, request)


@router.post("/users/{user_id}/unsuspend")
async def unsuspend_user(
    user_id: UUID,
    service: AdminService = Depends(get_admin_service),
):
    """
    Unsuspend a user account.

    Admin only endpoint.
    """
    return await service.unsuspend_user(user_id)


@router.patch("/users/{user_id}/tier")
async def change_user_tier(
    user_id: UUID,
    request: ChangeTierRequest,
    service: AdminService = Depends(get_admin_service),
):
    """
    Change user's subscription tier.

    Admin only endpoint.
    """
    return await service.change_user_tier(user_id, request)


# ==========================================
# Streams Monitoring Endpoints
# ==========================================


@router.get("/streams/all", response_model=StreamListResponse)
async def list_all_streams(
    status: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status_filter"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    service: AdminService = Depends(get_admin_service),
):
    """
    List all streams across all users.

    Admin only endpoint.
    """
    effective_status = status if status is not None else status_filter
    return await service.list_all_streams(effective_status, limit, offset)


@router.post("/streams/{stream_id}/stop")
async def force_stop_stream(
    stream_id: UUID,
    service: AdminService = Depends(get_admin_service),
):
    """
    Force stop a stream (admin override).

    Admin only endpoint.
    """
    return await service.force_stop_stream(stream_id)


# ==========================================
# System Alerts Endpoints
# ==========================================


@router.get("/alerts", response_model=AlertListResponse)
async def list_alerts(
    resolved: Optional[bool] = None,
    severity: Optional[str] = None,
    alert_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    service: AdminService = Depends(get_admin_service),
):
    """
    List system alerts with filters.

    Admin only endpoint.
    """
    return await service.list_alerts(resolved, severity, alert_type, limit, offset)


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: UUID,
    request: ResolveAlertRequest,
    service: AdminService = Depends(get_admin_service),
):
    """
    Mark an alert as resolved.

    Admin only endpoint.
    """
    return await service.resolve_alert(alert_id, request)


# ==========================================
# Admin Activity Log
# ==========================================


@router.get("/actions", response_model=List[AdminActionLog])
async def list_admin_actions(
    action_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    service: AdminService = Depends(get_admin_service),
):
    """
    List admin actions (audit log).

    Admin only endpoint.
    """
    return await service.list_admin_actions(action_type, limit, offset)
