"""
Admin API Routes

Endpoints for admin panel: user management, stream monitoring, system alerts.
Only accessible by users with is_admin=True.
"""

from fastapi import APIRouter, HTTPException, status, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, update
from typing import List, Optional
from uuid import UUID
from datetime import datetime, timezone
import logging

from app.api.deps import require_user
from app.models.database import (
    UserProfile, SubscriptionTierLimits, AdminAction, SystemAlert,
    Stream, StreamDestination, Asset, Playlist, Destination
)
from pydantic import BaseModel, Field, ConfigDict

logger = logging.getLogger(__name__)
router = APIRouter()


# ==========================================
# Request/Response Models
# ==========================================

class UserListItem(BaseModel):
    """User list item for admin panel"""
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
    """Detailed user information"""
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
    """Request to suspend a user"""
    reason: str = Field(..., min_length=1, max_length=500)


class ChangeTierRequest(BaseModel):
    """Request to change user's subscription tier"""
    new_tier: str = Field(..., pattern="^(free|fhd_start|fhd_flow|fhd_boost|uhd_start|uhd_flow|uhd_boost)$")
    reason: Optional[str] = None


class StreamListItem(BaseModel):
    """Stream list item for monitoring"""
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
    """System alert item"""
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
    """Request to resolve an alert"""
    resolution_notes: Optional[str] = None


class AdminActionLog(BaseModel):
    """Admin action log entry"""
    id: UUID
    admin_user_id: UUID
    admin_email: str
    action_type: str
    target_user_id: Optional[UUID]
    target_user_email: Optional[str]
    details: dict
    created_at: datetime


class AdminAccessResponse(BaseModel):
    """Response payload for verifying admin access"""
    user_id: UUID
    email: str
    full_name: Optional[str]
    subscription_tier: str
    subscription_status: str
    is_admin: bool
    is_suspended: bool


# ==========================================
# Admin Permission Check
# ==========================================

async def require_admin(user_deps: tuple = Depends(require_user)) -> tuple[AsyncSession, UUID]:
    """
    Dependency to ensure user is an admin.
    
    Returns:
        Tuple of (db_session, admin_user_id)
    
    Raises:
        HTTPException: If user is not an admin
    """
    db, user_id = user_deps
    
    # Check if user is admin
    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found"
        )
    
    if not profile.is_admin:
        logger.warning(f"Non-admin user {user_id} attempted to access admin endpoint")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    
    return db, user_id


@router.get("/access", response_model=AdminAccessResponse)
async def get_admin_access(admin_deps: tuple = Depends(require_admin)):
    """Return basic admin profile data when access is granted."""

    db, admin_user_id = admin_deps

    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == admin_user_id)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admin profile not found"
        )

    return AdminAccessResponse(
        user_id=profile.user_id,
        email=profile.email,
        full_name=profile.full_name,
        subscription_tier=profile.subscription_tier,
        subscription_status=profile.subscription_status,
        is_admin=profile.is_admin,
        is_suspended=profile.is_suspended,
    )


async def log_admin_action(
    db: AsyncSession,
    admin_user_id: UUID,
    action_type: str,
    target_user_id: Optional[UUID] = None,
    details: dict = None
):
    """
    Log an admin action to the database.
    
    Args:
        db: Database session
        admin_user_id: Admin performing the action
        action_type: Type of action (suspend_user, change_tier, etc.)
        target_user_id: User affected by the action
        details: Additional details about the action
    """
    try:
        action = AdminAction(
            admin_user_id=admin_user_id,
            action_type=action_type,
            target_user_id=target_user_id,
            details=details or {}
        )
        db.add(action)
        await db.flush()
        
        logger.info(f"Admin action logged: {action_type} by {admin_user_id}")
    except Exception as e:
        logger.error(f"Failed to log admin action: {e}")
        # Don't fail the main operation if logging fails


# ==========================================
# User Management Endpoints
# ==========================================

@router.get("/users", response_model=List[UserListItem])
async def list_users(
    tier: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    suspended: Optional[bool] = Query(None),
    is_suspended: Optional[bool] = Query(None, alias="is_suspended"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    admin_deps: tuple = Depends(require_admin)
):
    """
    List all users with filters.
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        query = select(UserProfile)
        
        # Apply filters
        if tier:
            query = query.where(UserProfile.subscription_tier == tier)
        if status:
            query = query.where(UserProfile.subscription_status == status)
        suspended_filter = suspended if suspended is not None else is_suspended
        if suspended_filter is not None:
            query = query.where(UserProfile.is_suspended == suspended_filter)
        
        query = query.order_by(desc(UserProfile.created_at)).limit(limit).offset(offset)
        
        result = await db.execute(query)
        users = result.scalars().all()

        return [
            UserListItem(
                user_id=user.user_id,
                email=user.email,
                full_name=user.full_name,
                subscription_tier=user.subscription_tier,
                subscription_status=user.subscription_status,
                subscription_started_at=user.subscription_started_at,
                subscription_expires_at=user.subscription_expires_at,
                is_suspended=user.is_suspended,
                current_storage_bytes=user.current_storage_bytes or 0,
                total_stream_hours=user.total_stream_hours or 0,
                created_at=user.created_at,
                last_login_at=user.last_login_at,
            )
            for user in users
        ]
        
    except Exception as e:
        logger.exception(f"Error listing users: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list users: {str(e)}"
        )


@router.get("/users/{user_id}", response_model=UserDetail)
async def get_user_detail(
    user_id: UUID,
    admin_deps: tuple = Depends(require_admin)
):
    """
    Get detailed information about a user.
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        # Get user profile
        result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        # Get counts
        assets_result = await db.execute(
            select(func.count(Asset.id)).where(Asset.user_id == user_id)
        )
        assets_count = assets_result.scalar()
        
        playlists_result = await db.execute(
            select(func.count(Playlist.id)).where(Playlist.user_id == user_id)
        )
        playlists_count = playlists_result.scalar()
        
        destinations_result = await db.execute(
            select(func.count(Destination.id)).where(Destination.user_id == user_id)
        )
        destinations_count = destinations_result.scalar()
        
        streams_result = await db.execute(
            select(func.count(Stream.id)).where(Stream.user_id == user_id)
        )
        streams_count = streams_result.scalar()
        
        active_streams_result = await db.execute(
            select(func.count(Stream.id)).where(
                Stream.user_id == user_id,
                Stream.status.in_(['running', 'starting'])
            )
        )
        active_streams_count = active_streams_result.scalar()
        
        return UserDetail(
            user_id=profile.user_id,
            email=profile.email,
            full_name=profile.full_name,
            company_name=profile.company_name,
            subscription_tier=profile.subscription_tier,
            subscription_status=profile.subscription_status,
            subscription_started_at=profile.subscription_started_at,
            subscription_expires_at=profile.subscription_expires_at,
            is_admin=profile.is_admin,
            is_suspended=profile.is_suspended,
            suspension_reason=profile.suspension_reason,
            current_storage_bytes=profile.current_storage_bytes or 0,
            total_stream_hours=profile.total_stream_hours or 0,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
            last_login_at=profile.last_login_at,
            assets_count=assets_count,
            playlists_count=playlists_count,
            destinations_count=destinations_count,
            streams_count=streams_count,
            active_streams_count=active_streams_count
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting user detail: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get user detail: {str(e)}"
        )


@router.post("/users/{user_id}/suspend")
async def suspend_user(
    user_id: UUID,
    request: SuspendUserRequest,
    admin_deps: tuple = Depends(require_admin)
):
    """
    Suspend a user account.
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        # Get user
        result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        # Can't suspend yourself
        if user_id == admin_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot suspend yourself"
            )
        
        # Can't suspend another admin
        if profile.is_admin:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot suspend another admin"
            )
        
        # Suspend user
        profile.is_suspended = True
        profile.suspension_reason = request.reason
        
        # Stop all active streams
        await db.execute(
            update(Stream)
            .where(
                Stream.user_id == user_id,
                Stream.status.in_(['running', 'starting'])
            )
            .values(status='stopped')
        )
        
        # Log action
        await log_admin_action(
            db, admin_user_id, 'suspend_user',
            target_user_id=user_id,
            details={'reason': request.reason}
        )
        
        await db.commit()
        
        logger.info(f"User {user_id} suspended by admin {admin_user_id}")
        
        return {"status": "success", "message": "User suspended"}
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error suspending user: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to suspend user: {str(e)}"
        )


@router.post("/users/{user_id}/unsuspend")
async def unsuspend_user(
    user_id: UUID,
    admin_deps: tuple = Depends(require_admin)
):
    """
    Unsuspend a user account.
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        profile.is_suspended = False
        profile.suspension_reason = None
        
        await log_admin_action(
            db, admin_user_id, 'unsuspend_user',
            target_user_id=user_id
        )
        
        await db.commit()
        
        logger.info(f"User {user_id} unsuspended by admin {admin_user_id}")
        
        return {"status": "success", "message": "User unsuspended"}
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error unsuspending user: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to unsuspend user: {str(e)}"
        )


@router.patch("/users/{user_id}/tier")
async def change_user_tier(
    user_id: UUID,
    request: ChangeTierRequest,
    admin_deps: tuple = Depends(require_admin)
):
    """
    Change user's subscription tier.
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        # Get user
        result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        # Verify tier exists
        tier_result = await db.execute(
            select(SubscriptionTierLimits).where(
                SubscriptionTierLimits.tier == request.new_tier
            )
        )
        tier = tier_result.scalar_one_or_none()
        
        if not tier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid tier: {request.new_tier}"
            )
        
        old_tier = profile.subscription_tier
        previous_started_at = profile.subscription_started_at
        profile.subscription_tier = request.new_tier
        profile.subscription_started_at = datetime.now(timezone.utc)
        profile.subscription_expires_at = None
        if profile.subscription_status != 'active':
            profile.subscription_status = 'active'
        
        # Log action
        await log_admin_action(
            db, admin_user_id, 'change_tier',
            target_user_id=user_id,
            details={
                'old_tier': old_tier,
                'new_tier': request.new_tier,
                'reason': request.reason,
                'previous_started_at': previous_started_at.isoformat() if previous_started_at else None,
            }
        )
        
        await db.commit()
        
        logger.info(f"User {user_id} tier changed from {old_tier} to {request.new_tier} by admin {admin_user_id}")
        
        return {
            "status": "success",
            "message": f"Tier changed from {old_tier} to {request.new_tier}"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error changing user tier: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to change tier: {str(e)}"
        )


# ==========================================
# Streams Monitoring Endpoints
# ==========================================

@router.get("/streams/all", response_model=List[StreamListItem])
async def list_all_streams(
    status: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status_filter"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    admin_deps: tuple = Depends(require_admin)
):
    """
    List all streams across all users.
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        query = (
            select(
                Stream.id,
                Stream.user_id,
                UserProfile.email,
                Stream.name,
                Stream.status,
                Stream.playlist_id,
                Stream.source_type,
                Stream.started_at,
                Stream.created_at
            )
            .join(UserProfile, Stream.user_id == UserProfile.user_id)
        )
        
        effective_status = status if status is not None else status_filter
        if effective_status:
            query = query.where(Stream.status == effective_status)
        
        query = query.order_by(desc(Stream.created_at)).limit(limit).offset(offset)
        
        result = await db.execute(query)
        rows = result.all()

        stream_ids = [row[0] for row in rows]
        destination_counts = {}
        if stream_ids:
            dest_result = await db.execute(
                select(StreamDestination.stream_id, func.count(StreamDestination.id))
                .where(StreamDestination.stream_id.in_(stream_ids))
                .group_by(StreamDestination.stream_id)
            )
            destination_counts = {stream_id: count for stream_id, count in dest_result.all()}

        streams = [
            StreamListItem(
                stream_id=row[0],
                user_id=row[1],
                user_email=row[2],
                name=row[3] or "Unnamed stream",
                status=row[4],
                playlist_id=row[5],
                source_type=row[6],
                destinations_count=destination_counts.get(row[0], 0),
                started_at=row[7],
                created_at=row[8],
            )
            for row in rows
        ]

        return streams
        
    except Exception as e:
        logger.exception(f"Error listing streams: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list streams: {str(e)}"
        )


@router.post("/streams/{stream_id}/stop")
async def force_stop_stream(
    stream_id: UUID,
    admin_deps: tuple = Depends(require_admin)
):
    """
    Force stop a stream (admin override).
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        # Get stream
        result = await db.execute(
            select(Stream).where(Stream.id == stream_id)
        )
        stream = result.scalar_one_or_none()
        
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found"
            )
        
        # Stop the stream
        from app.streaming.ffmpeg_manager import ffmpeg_manager
        ffmpeg_manager.stop_stream(str(stream_id))
        
        stream.status = 'stopped'
        
        # Log action
        await log_admin_action(
            db, admin_user_id, 'force_stop_stream',
            target_user_id=stream.user_id,
            details={'stream_id': str(stream_id), 'stream_name': stream.name}
        )
        
        await db.commit()
        
        logger.info(f"Stream {stream_id} force stopped by admin {admin_user_id}")
        
        return {
            "stream_id": str(stream_id),
            "status": stream.status,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error stopping stream: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stop stream: {str(e)}"
        )


# ==========================================
# System Alerts Endpoints
# ==========================================

@router.get("/alerts", response_model=List[AlertListItem])
async def list_alerts(
    resolved: Optional[bool] = None,
    severity: Optional[str] = None,
    alert_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    admin_deps: tuple = Depends(require_admin)
):
    """
    List system alerts with filters.
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        query = (
            select(
                SystemAlert.id,
                SystemAlert.user_id,
                UserProfile.email,
                SystemAlert.alert_type,
                SystemAlert.severity,
                SystemAlert.message,
                SystemAlert.resolved,
                SystemAlert.created_at,
                SystemAlert.resolved_at,
                SystemAlert.resolved_by
            )
            .join(UserProfile, SystemAlert.user_id == UserProfile.user_id)
        )
        
        if resolved is not None:
            query = query.where(SystemAlert.resolved == resolved)
        if severity:
            query = query.where(SystemAlert.severity == severity)
        if alert_type:
            query = query.where(SystemAlert.alert_type == alert_type)
        
        query = query.order_by(desc(SystemAlert.created_at)).limit(limit).offset(offset)
        
        result = await db.execute(query)
        rows = result.all()
        
        alerts = []
        for row in rows:
            alerts.append(AlertListItem(
                alert_id=row[0],
                user_id=row[1],
                user_email=row[2],
                alert_type=row[3],
                severity=row[4],
                message=row[5],
                resolved=row[6],
                created_at=row[7],
                resolved_at=row[8],
                resolved_by=row[9]
            ))
        
        return alerts
        
    except Exception as e:
        logger.exception(f"Error listing alerts: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list alerts: {str(e)}"
        )


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: UUID,
    request: ResolveAlertRequest,
    admin_deps: tuple = Depends(require_admin)
):
    """
    Mark an alert as resolved.
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        result = await db.execute(
            select(SystemAlert).where(SystemAlert.id == alert_id)
        )
        alert = result.scalar_one_or_none()
        
        if not alert:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Alert not found"
            )
        
        alert.resolved = True
        alert.resolved_at = datetime.utcnow()
        alert.resolved_by = admin_user_id

        details = alert.details or {}
        if request.resolution_notes:
            details['resolution_notes'] = request.resolution_notes
        alert.details = details
        alert.resolution_notes = request.resolution_notes
        
        await log_admin_action(
            db, admin_user_id, 'resolve_alert',
            details={
                'alert_id': str(alert_id),
                'alert_type': alert.alert_type,
                'notes': request.resolution_notes
            }
        )
        
        await db.commit()
        await db.refresh(alert)

        user_email = None
        if alert.user_id:
            email_result = await db.execute(
                select(UserProfile.email).where(UserProfile.user_id == alert.user_id)
            )
            user_email = email_result.scalar_one_or_none()

        logger.info(f"Alert {alert_id} resolved by admin {admin_user_id}")

        return AlertListItem(
            alert_id=alert.id,
            user_id=alert.user_id,
            user_email=user_email or "Unknown user",
            alert_type=alert.alert_type,
            severity=alert.severity,
            message=alert.message,
            resolved=alert.resolved,
            created_at=alert.created_at,
            resolved_at=alert.resolved_at,
            resolved_by=alert.resolved_by,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error resolving alert: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to resolve alert: {str(e)}"
        )


# ==========================================
# Admin Activity Log
# ==========================================

@router.get("/actions", response_model=List[AdminActionLog])
async def list_admin_actions(
    action_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    admin_deps: tuple = Depends(require_admin)
):
    """
    List admin actions (audit log).
    
    Admin only endpoint.
    """
    db, admin_user_id = admin_deps
    
    try:
        query = (
            select(
                AdminAction.id,
                AdminAction.admin_user_id,
                UserProfile.email,
                AdminAction.action_type,
                AdminAction.target_user_id,
                AdminAction.details,
                AdminAction.created_at
            )
            .join(UserProfile, AdminAction.admin_user_id == UserProfile.user_id)
        )
        
        if action_type:
            query = query.where(AdminAction.action_type == action_type)
        
        query = query.order_by(desc(AdminAction.created_at)).limit(limit).offset(offset)
        
        result = await db.execute(query)
        rows = result.all()
        
        # Get target user emails
        actions = []
        for row in rows:
            target_email = None
            if row[4]:  # target_user_id
                target_result = await db.execute(
                    select(UserProfile.email).where(UserProfile.user_id == row[4])
                )
                target_email = target_result.scalar_one_or_none()
            
            actions.append(AdminActionLog(
                id=row[0],
                admin_user_id=row[1],
                admin_email=row[2],
                action_type=row[3],
                target_user_id=row[4],
                target_user_email=target_email,
                details=row[5],
                created_at=row[6]
            ))
        
        return actions
        
    except Exception as e:
        logger.exception(f"Error listing admin actions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list admin actions: {str(e)}"
        )
