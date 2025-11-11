"""Business logic for admin operations."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    AdminAction,
    Asset,
    Destination,
    Playlist,
    Stream,
    StreamDestination,
    SubscriptionTierLimits,
    SystemAlert,
    UserProfile,
)
from app.schemas.admin import (
    AdminAccessResponse,
    AdminActionLog,
    AlertListItem,
    ChangeTierRequest,
    ResolveAlertRequest,
    StreamListItem,
    SuspendUserRequest,
    UserDetail,
    UserListItem,
)

logger = logging.getLogger(__name__)


class AdminService:
    """Encapsulates all admin-oriented operations."""

    def __init__(self, db: AsyncSession, admin_user_id: UUID):
        self.db = db
        self.admin_user_id = admin_user_id

    async def get_admin_access(self) -> AdminAccessResponse:
        profile = await self._get_user_profile(self.admin_user_id, not_found_message="Admin profile not found")
        return AdminAccessResponse(
            user_id=profile.user_id,
            email=profile.email,
            full_name=profile.full_name,
            subscription_tier=profile.subscription_tier,
            subscription_status=profile.subscription_status,
            is_admin=profile.is_admin,
            is_suspended=profile.is_suspended,
        )

    async def list_users(
        self,
        tier: Optional[str],
        status_filter: Optional[str],
        suspended_filter: Optional[bool],
        limit: int,
        offset: int,
    ) -> List[UserListItem]:
        try:
            query = select(UserProfile)

            if tier:
                query = query.where(UserProfile.subscription_tier == tier)
            if status_filter:
                query = query.where(UserProfile.subscription_status == status_filter)
            if suspended_filter is not None:
                query = query.where(UserProfile.is_suspended == suspended_filter)

            query = query.order_by(desc(UserProfile.created_at)).limit(limit).offset(offset)

            result = await self.db.execute(query)
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
        except Exception as exc:
            logger.exception("Error listing users: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to list users: {exc}",
            ) from exc

    async def get_user_detail(self, user_id: UUID) -> UserDetail:
        try:
            profile = await self._get_user_profile(user_id)

            assets_count = await self._count_records(Asset, user_id)
            playlists_count = await self._count_records(Playlist, user_id)
            destinations_count = await self._count_records(Destination, user_id)
            streams_count = await self._count_records(Stream, user_id)
            active_streams_count = await self._count_active_streams(user_id)

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
                active_streams_count=active_streams_count,
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Error getting user detail: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to get user detail: {exc}",
            ) from exc

    async def suspend_user(self, user_id: UUID, payload: SuspendUserRequest) -> dict:
        try:
            profile = await self._get_user_profile(user_id)

            if user_id == self.admin_user_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot suspend yourself",
                )

            if profile.is_admin:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot suspend another admin",
                )

            profile.is_suspended = True
            profile.suspension_reason = payload.reason

            await self.db.execute(
                update(Stream)
                .where(Stream.user_id == user_id, Stream.status.in_(["running", "starting"]))
                .values(status="stopped")
            )

            await self._log_admin_action(
                action_type="suspend_user",
                target_user_id=user_id,
                details={"reason": payload.reason},
            )

            await self.db.commit()
            logger.info("User %s suspended by admin %s", user_id, self.admin_user_id)
            return {"status": "success", "message": "User suspended"}
        except HTTPException:
            await self.db.rollback()
            raise
        except Exception as exc:
            await self.db.rollback()
            logger.exception("Error suspending user: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to suspend user: {exc}",
            ) from exc

    async def unsuspend_user(self, user_id: UUID) -> dict:
        try:
            profile = await self._get_user_profile(user_id)
            profile.is_suspended = False
            profile.suspension_reason = None

            await self._log_admin_action(
                action_type="unsuspend_user",
                target_user_id=user_id,
            )

            await self.db.commit()
            logger.info("User %s unsuspended by admin %s", user_id, self.admin_user_id)
            return {"status": "success", "message": "User unsuspended"}
        except HTTPException:
            await self.db.rollback()
            raise
        except Exception as exc:
            await self.db.rollback()
            logger.exception("Error unsuspending user: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to unsuspend user: {exc}",
            ) from exc

    async def change_user_tier(self, user_id: UUID, payload: ChangeTierRequest) -> dict:
        try:
            profile = await self._get_user_profile(user_id)

            tier_result = await self.db.execute(
                select(SubscriptionTierLimits).where(SubscriptionTierLimits.tier == payload.new_tier)
            )
            tier = tier_result.scalar_one_or_none()
            if not tier:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid tier: {payload.new_tier}",
                )

            old_tier = profile.subscription_tier
            previous_started_at = profile.subscription_started_at
            profile.subscription_tier = payload.new_tier
            profile.subscription_started_at = datetime.now(timezone.utc)
            profile.subscription_expires_at = None
            if profile.subscription_status != "active":
                profile.subscription_status = "active"

            await self._log_admin_action(
                action_type="change_tier",
                target_user_id=user_id,
                details={
                    "old_tier": old_tier,
                    "new_tier": payload.new_tier,
                    "reason": payload.reason,
                    "previous_started_at": previous_started_at.isoformat() if previous_started_at else None,
                },
            )

            await self.db.commit()
            logger.info(
                "User %s tier changed from %s to %s by admin %s",
                user_id,
                old_tier,
                payload.new_tier,
                self.admin_user_id,
            )
            return {
                "status": "success",
                "message": f"Tier changed from {old_tier} to {payload.new_tier}",
            }
        except HTTPException:
            await self.db.rollback()
            raise
        except Exception as exc:
            await self.db.rollback()
            logger.exception("Error changing user tier: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to change tier: {exc}",
            ) from exc

    async def list_all_streams(
        self, status_filter: Optional[str], limit: int, offset: int
    ) -> List[StreamListItem]:
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
                    Stream.created_at,
                )
                .join(UserProfile, Stream.user_id == UserProfile.user_id)
            )

            if status_filter:
                query = query.where(Stream.status == status_filter)

            query = query.order_by(desc(Stream.created_at)).limit(limit).offset(offset)

            result = await self.db.execute(query)
            rows = result.all()
            stream_ids = [row[0] for row in rows]

            destination_counts = {}
            if stream_ids:
                dest_result = await self.db.execute(
                    select(StreamDestination.stream_id, func.count(StreamDestination.id))
                    .where(StreamDestination.stream_id.in_(stream_ids))
                    .group_by(StreamDestination.stream_id)
                )
                destination_counts = {stream_id: count for stream_id, count in dest_result.all()}

            return [
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
        except Exception as exc:
            logger.exception("Error listing streams: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to list streams: {exc}",
            ) from exc

    async def force_stop_stream(self, stream_id: UUID) -> dict:
        try:
            stream_result = await self.db.execute(select(Stream).where(Stream.id == stream_id))
            stream = stream_result.scalar_one_or_none()
            if not stream:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found")

            from app.streaming.ffmpeg_manager import ffmpeg_manager

            ffmpeg_manager.stop_stream(str(stream_id))
            stream.status = "stopped"

            await self._log_admin_action(
                action_type="force_stop_stream",
                target_user_id=stream.user_id,
                details={"stream_id": str(stream_id), "stream_name": stream.name},
            )

            await self.db.commit()
            logger.info("Stream %s force stopped by admin %s", stream_id, self.admin_user_id)
            return {"stream_id": str(stream_id), "status": stream.status}
        except HTTPException:
            await self.db.rollback()
            raise
        except Exception as exc:
            await self.db.rollback()
            logger.exception("Error stopping stream: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to stop stream: {exc}",
            ) from exc

    async def list_alerts(
        self,
        resolved: Optional[bool],
        severity: Optional[str],
        alert_type: Optional[str],
        limit: int,
        offset: int,
    ) -> List[AlertListItem]:
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
                    SystemAlert.resolved_by,
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

            result = await self.db.execute(query)
            rows = result.all()
            return [
                AlertListItem(
                    alert_id=row[0],
                    user_id=row[1],
                    user_email=row[2],
                    alert_type=row[3],
                    severity=row[4],
                    message=row[5],
                    resolved=row[6],
                    created_at=row[7],
                    resolved_at=row[8],
                    resolved_by=row[9],
                )
                for row in rows
            ]
        except Exception as exc:
            logger.exception("Error listing alerts: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to list alerts: {exc}",
            ) from exc

    async def resolve_alert(self, alert_id: UUID, payload: ResolveAlertRequest) -> AlertListItem:
        try:
            result = await self.db.execute(select(SystemAlert).where(SystemAlert.id == alert_id))
            alert = result.scalar_one_or_none()
            if not alert:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")

            alert.resolved = True
            alert.resolved_at = datetime.utcnow()
            alert.resolved_by = self.admin_user_id
            details = alert.details or {}
            if payload.resolution_notes:
                details["resolution_notes"] = payload.resolution_notes
            alert.details = details
            alert.resolution_notes = payload.resolution_notes

            await self._log_admin_action(
                action_type="resolve_alert",
                details={
                    "alert_id": str(alert_id),
                    "alert_type": alert.alert_type,
                    "notes": payload.resolution_notes,
                },
            )

            await self.db.commit()
            await self.db.refresh(alert)

            user_email = None
            if alert.user_id:
                email_result = await self.db.execute(
                    select(UserProfile.email).where(UserProfile.user_id == alert.user_id)
                )
                user_email = email_result.scalar_one_or_none()

            logger.info("Alert %s resolved by admin %s", alert_id, self.admin_user_id)
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
            await self.db.rollback()
            raise
        except Exception as exc:
            await self.db.rollback()
            logger.exception("Error resolving alert: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to resolve alert: {exc}",
            ) from exc

    async def list_admin_actions(
        self, action_type: Optional[str], limit: int, offset: int
    ) -> List[AdminActionLog]:
        try:
            query = (
                select(
                    AdminAction.id,
                    AdminAction.admin_user_id,
                    UserProfile.email,
                    AdminAction.action_type,
                    AdminAction.target_user_id,
                    AdminAction.details,
                    AdminAction.created_at,
                )
                .join(UserProfile, AdminAction.admin_user_id == UserProfile.user_id)
            )

            if action_type:
                query = query.where(AdminAction.action_type == action_type)

            query = query.order_by(desc(AdminAction.created_at)).limit(limit).offset(offset)

            result = await self.db.execute(query)
            rows = result.all()

            actions: List[AdminActionLog] = []
            target_email_cache: dict[UUID, Optional[str]] = {}
            for row in rows:
                target_user_id = row[4]
                target_email = None
                if target_user_id:
                    if target_user_id not in target_email_cache:
                        target_result = await self.db.execute(
                            select(UserProfile.email).where(UserProfile.user_id == target_user_id)
                        )
                        target_email_cache[target_user_id] = target_result.scalar_one_or_none()
                    target_email = target_email_cache[target_user_id]

                actions.append(
                    AdminActionLog(
                        id=row[0],
                        admin_user_id=row[1],
                        admin_email=row[2],
                        action_type=row[3],
                        target_user_id=target_user_id,
                        target_user_email=target_email,
                        details=row[5],
                        created_at=row[6],
                    )
                )

            return actions
        except Exception as exc:
            logger.exception("Error listing admin actions: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to list admin actions: {exc}",
            ) from exc

    async def _get_user_profile(
        self, user_id: UUID, not_found_message: str = "User not found"
    ) -> UserProfile:
        result = await self.db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_message)
        return profile

    async def _count_records(self, model, user_id: UUID) -> int:
        result = await self.db.execute(
            select(func.count(model.id)).where(model.user_id == user_id)
        )
        return result.scalar() or 0

    async def _count_active_streams(self, user_id: UUID) -> int:
        result = await self.db.execute(
            select(func.count(Stream.id)).where(
                Stream.user_id == user_id,
                Stream.status.in_(["running", "starting"]),
            )
        )
        return result.scalar() or 0

    async def _log_admin_action(
        self,
        action_type: str,
        target_user_id: Optional[UUID] = None,
        details: Optional[dict] = None,
    ) -> None:
        try:
            action = AdminAction(
                admin_user_id=self.admin_user_id,
                action_type=action_type,
                target_user_id=target_user_id,
                details=details or {},
            )
            self.db.add(action)
            await self.db.flush()
            logger.info("Admin action logged: %s by %s", action_type, self.admin_user_id)
        except Exception as exc:
            logger.error("Failed to log admin action %s: %s", action_type, exc)
            # Don't fail the main operation if logging fails

