"""Runtime management for streams (start/stop/status/logs)."""

from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as default_settings
from app.core.quota import (
    QuotaEnforcer as DefaultQuotaEnforcer,
    missing_tier_limits_detail,
)
from app.core.stream_runtime_heartbeat import (
    get_runtime_heartbeat_datetime,
    read_runtime_heartbeat,
    stale_runtime_heartbeat_reason,
)
from app.core.systemd_control import (
    systemd_enabled,
    is_active as systemd_is_active,
    restart_unit as systemd_restart_unit,
    start_unit as systemd_start_unit,
    stop_unit as systemd_stop_unit,
    unit_status as systemd_unit_status,
)
from app.models.database import Stream
from app.schemas.api import StreamLogsResponse, StreamQualityResponse, StreamStatus
from app.services.youtube import YoutubeProviderStatusService
from app.streaming.ffmpeg_manager import ffmpeg_manager as default_ffmpeg_manager
from app.streaming.hot_swap import hot_swap_manager

from .audit import attach_runtime_incident_summaries, persist_stream_audit_event
from .control_helpers import (
    build_status_payload,
    build_stop_activity_payload,
    build_stop_audit_metadata,
    clear_schedule as _helper_clear_schedule,
    clear_start_schedule as _helper_clear_start_schedule,
    clear_stop_schedule as _helper_clear_stop_schedule,
    finalize_stopped as _helper_finalize_stopped,
    mark_restart_success as _helper_mark_restart_success,
    stream_may_still_be_live as _helper_stream_may_still_be_live,
)
from .helpers import (
    collect_live_output_compatibility_violations,
    extract_stream_assets,
    gather_stream_destinations,
    load_stream_with_relations,
    prepare_stream_launch,
    validate_stream_launch_prerequisites,
)
from .status_helpers import (
    aware_datetime,
    filter_important_ffmpeg_logs,
    uptime_seconds as compute_uptime_seconds,
)
from .audit import record_stream_audit_event


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class StreamControlService:
    """Coordinates FFmpeg and systemd interactions for streams."""

    def __init__(
        self,
        db: AsyncSession,
        user_id: UUID,
        *,
        quota_cls=DefaultQuotaEnforcer,
        manager=default_ffmpeg_manager,
        settings_module=default_settings,
    ):
        self.db = db
        self.user_id = user_id
        self.quota_cls = quota_cls
        self.manager = manager
        self.settings = settings_module

    def supports_hot_swap(self) -> bool:
        """Hot swap is currently available only for in-process manager runtime."""
        return not systemd_enabled()

    async def ensure_schedule_update_allowed(self, stream: Stream) -> None:
        """Fail closed if managed runtime might still own the stream."""
        if systemd_enabled():
            await self._ensure_systemd_schedule_update_allowed(stream)
            return

        if stream.status in {"running", "starting", "stopping"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot schedule start while stream is running",
            )

    async def evaluate_quality(self, stream_id: UUID) -> StreamQualityResponse:
        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found"
            )

        selection = extract_stream_assets(stream)
        enforcer = self.quota_cls(self.db, self.user_id)
        quality = await enforcer.evaluate_stream_quality(
            selection.video_assets,
            audio_assets=selection.audio_assets,
            mix_mode=selection.mix_mode,
        )
        destinations = gather_stream_destinations(stream)
        quality["violations"].extend(
            await collect_live_output_compatibility_violations(selection, destinations)
        )
        if quality["violations"]:
            quality["ok"] = False

        return StreamQualityResponse(
            ok=quality["ok"],
            tier=quality["tier"],
            limits=quality["limits"],
            violations=quality["violations"],
            recommended=quality.get("recommended"),
            mode=quality.get("mode", "video"),
            audio_recommended=quality.get("audio_recommended"),
        )

    async def start_stream(
        self,
        stream_id: UUID,
        *,
        preserve_schedule: bool = False,
        reset_restart_policy: bool = True,
    ) -> StreamStatus:
        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found"
            )

        if systemd_enabled() and stream.status == "starting":
            usage = await self._get_usage_snapshot()
            return self._status_payload(
                stream,
                False,
                status_override="starting",
                usage=usage,
            )

        already_running = await self.get_stream_status(stream_id)
        if already_running.status in {"running", "starting", "stopping"}:
            return already_running

        await self._acquire_user_start_lock()
        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found"
            )

        enforcer = self.quota_cls(self.db, self.user_id)
        await enforcer.check_concurrent_streams()

        try:
            if systemd_enabled():
                _, _, log_file = await validate_stream_launch_prerequisites(
                    self.db,
                    self.user_id,
                    stream,
                    quota_evaluator=enforcer,
                    settings_obj=self.settings,
                )
                if await systemd_is_active(stream_id):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Stream already running",
                    )
                previous_status = stream.status
                previous_started_at = stream.started_at
                previous_stopped_at = stream.stopped_at
                previous_error_message = stream.error_message
                previous_log_path = stream.log_path
                previous_scheduled_start_enabled = stream.scheduled_start_enabled
                previous_scheduled_start_time = stream.scheduled_start_time
                previous_scheduled_start_attempted_at = (
                    stream.scheduled_start_attempted_at
                )
                stream.status = "starting"
                stream.started_at = None
                stream.stopped_at = None
                stream.error_message = None
                stream.log_path = str(log_file)
                if not preserve_schedule:
                    self._clear_start_schedule(stream)
                await self.db.commit()
                try:
                    await systemd_start_unit(stream_id)
                except Exception as err:
                    stream.status = previous_status
                    stream.started_at = previous_started_at
                    stream.stopped_at = previous_stopped_at
                    stream.error_message = previous_error_message
                    stream.log_path = previous_log_path
                    stream.scheduled_start_enabled = previous_scheduled_start_enabled
                    stream.scheduled_start_time = previous_scheduled_start_time
                    stream.scheduled_start_attempted_at = (
                        previous_scheduled_start_attempted_at
                    )
                    await self.db.commit()
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=str(err),
                    ) from err
                usage = await self._get_usage_snapshot(enforcer)
                return self._status_payload(
                    stream,
                    stream.status == "running",
                    usage=usage,
                )

            playlists, destinations, log_file = await prepare_stream_launch(
                self.db,
                self.user_id,
                stream,
                quota_evaluator=enforcer,
                settings_obj=self.settings,
            )

            success = await self.manager.start_stream(
                str(stream_id),
                playlists,
                destinations,
                log_file,
                metadata={
                    "user_id": self.user_id,
                    "stream_id": str(stream.id),
                    "playlist_id": (
                        str(stream.playlist_id) if stream.playlist_id else None
                    ),
                },
            )

            if not success:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to start stream",
                )

            stream.status = "running"
            stream.started_at = _utcnow()
            stream.stopped_at = None
            stream.error_message = None
            info = self.manager.get_stream_info(str(stream_id)) or {}
            stream.pid = info.get("pid")
            stream.log_path = str(log_file)
            if not preserve_schedule:
                self._clear_start_schedule(stream)
            await self.db.commit()
            usage = await self._get_usage_snapshot(enforcer)
            return self._status_payload(
                stream,
                True,
                info.get("uptime_seconds", 0),
                usage=usage,
            )
        except Exception:
            raise

    async def _acquire_user_start_lock(self) -> None:
        """Serialize concurrent stream-start requests for this user.

        Uses ``pg_advisory_xact_lock(int4, int4)`` on the same namespace
        (``QUOTA_LOCK_NAMESPACE_START_STREAM``) that ``QuotaEnforcer.check_concurrent_streams``
        acquires, so the lock is shared across the check and the insert
        (both run in this same transaction). The original implementation
        truncated the user UUID to 8 bytes — this version uses postgres
        ``hashtext`` to derive the second key from the full user-id string,
        eliminating the (small but real) collision risk.
        """
        from app.core.quota import (
            QUOTA_LOCK_NAMESPACE_START_STREAM,
            acquire_user_quota_lock,
        )

        await acquire_user_quota_lock(
            self.db, self.user_id, QUOTA_LOCK_NAMESPACE_START_STREAM
        )

    async def stop_stream(
        self,
        stream_id: UUID,
        *,
        source: str = "user_api",
        actor_user_id: UUID | None = None,
        reason: str | None = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> StreamStatus:
        stream = await self._get_stream_basic(stream_id)
        was_scheduled = stream.status == "scheduled"
        audit_metadata = self._build_stop_audit_metadata(
            stream,
            source=source,
            actor_user_id=actor_user_id,
            reason=reason,
            metadata=metadata,
        )
        await self._persist_stop_request_attribution(stream, metadata=audit_metadata)
        try:
            await self._stop_for_runtime(stream)
            self._clear_stop_schedule(stream)
            if was_scheduled:
                self._clear_start_schedule(stream)
            await self._record_stop_audit(
                stream, phase="completed", metadata=audit_metadata
            )
            await self.db.commit()
        except Exception as exc:
            stream_snapshot = {
                "stream_id": stream.id,
                "status": stream.status,
                "log_path": stream.log_path,
            }
            await self.db.rollback()
            await self._persist_stop_failure_attribution(
                stream_snapshot=stream_snapshot,
                metadata=audit_metadata,
                error_message=str(getattr(exc, "detail", exc)),
            )
            raise
        usage = await self._get_usage_snapshot()
        return self._status_payload(stream, False, usage=usage)

    async def restart_stream(
        self,
        stream_id: UUID,
        live_target: Optional[str] = None,
        *,
        orchestrated: bool = False,
    ) -> None:
        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found"
            )

        if systemd_enabled():
            try:
                await systemd_restart_unit(stream_id)
            except RuntimeError as err:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)
                ) from err
            stream = await self._get_stream_basic_for_update(stream_id)
            self._mark_restart_success(stream, orchestrated=False)
            stream.started_at = None
            await self.db.commit()
            return

        enforcer = self.quota_cls(self.db, self.user_id)
        playlists, destinations, log_file = await prepare_stream_launch(
            self.db,
            self.user_id,
            stream,
            quota_evaluator=enforcer,
            settings_obj=self.settings,
        )
        restart_ok = await self.manager.restart_stream(
            str(stream_id),
            playlists,
            destinations=destinations,
            log_file=log_file,
            metadata={
                "user_id": self.user_id,
                "stream_id": str(stream.id),
                "live_edit_target": live_target,
            },
        )
        if not restart_ok:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to restart stream",
            )
        self._mark_restart_success(stream, orchestrated=orchestrated)
        await self.db.commit()

    async def enqueue_hot_swap(
        self, stream_id: UUID, target: str, asset_payload: Dict[str, Any]
    ) -> None:
        if systemd_enabled():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Hot swapping is not supported for managed runtime streams",
            )

        stream = await self._get_stream_basic(stream_id)
        if stream.status != "running" or not self.manager.is_running(str(stream_id)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stream must be running to append new assets",
            )

        try:
            await hot_swap_manager.enqueue_asset(str(stream_id), target, asset_payload)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

    async def apply_live_collection_update(
        self,
        stream: Stream,
        target: str,
        assets: List[Dict[str, Any]],
        *,
        loop_enabled: bool,
        shuffle_enabled: bool,
    ) -> bool:
        if not self.supports_hot_swap():
            return False

        if stream.status != "running" or not self.manager.is_running(str(stream.id)):
            return False

        try:
            await hot_swap_manager.replace_queue(
                str(stream.id),
                target,
                assets,
                loop=loop_enabled,
                shuffle=shuffle_enabled,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc
        return True

    async def ensure_stopped(
        self,
        stream: Stream,
        *,
        source: str = "ensure_stopped",
        actor_user_id: UUID | None = None,
        reason: str | None = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        audit_metadata = self._build_stop_audit_metadata(
            stream,
            source=source,
            actor_user_id=actor_user_id,
            reason=reason,
            metadata=metadata,
        )
        await self._record_stop_audit(
            stream, phase="requested", metadata=audit_metadata
        )
        if systemd_enabled():
            if await systemd_is_active(stream.id):
                try:
                    await systemd_stop_unit(stream.id)
                except RuntimeError as err:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=str(err),
                    ) from err
            stream.status = "stopped"
            stream.pid = None
            stream.stopped_at = _utcnow()
            self._clear_schedule(stream)
            await self._record_stop_audit(
                stream, phase="completed", metadata=audit_metadata
            )
            return

        if self.manager.is_running(str(stream.id)):
            await self.manager.stop_stream(str(stream.id))
        stream.status = "stopped"
        stream.pid = None
        stream.stopped_at = _utcnow()
        self._clear_schedule(stream)
        await self._record_stop_audit(
            stream, phase="completed", metadata=audit_metadata
        )

    async def get_stream_status(self, stream_id: UUID) -> StreamStatus:
        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stream not found",
            )
        await YoutubeProviderStatusService(self.db).enrich_streams([stream])
        await attach_runtime_incident_summaries(self.db, [stream], manager=self.manager)

        if systemd_enabled():
            info = await systemd_unit_status(stream_id)
            usage = await self._get_usage_snapshot()
            previous_status = stream.status
            active_state = str(info.get("ActiveState") or "").lower()
            heartbeat_payload = read_runtime_heartbeat(stream_id)
            stale_heartbeat = stale_runtime_heartbeat_reason(heartbeat_payload)
            fresh_heartbeat = heartbeat_payload is not None and not stale_heartbeat
            preserve_starting = (
                active_state in {"", "unknown", "inactive", "dead"}
                and previous_status == "starting"
            )
            preserve_scheduled = previous_status == "scheduled" and active_state in {
                "",
                "unknown",
                "inactive",
                "dead",
            }

            if stale_heartbeat:
                effective_now = _utcnow()
                stream.status = "error"
                stream.pid = None
                if stream.stopped_at is None:
                    stream.stopped_at = effective_now
                stream.error_message = stale_heartbeat[:500]
                await self.db.commit()
                return self._status_payload(
                    stream,
                    False,
                    0,
                    status_override="error",
                    error_message=stream.error_message,
                    usage=usage,
                )

            if preserve_scheduled:
                normalized_status = "scheduled"
            elif active_state == "active":
                normalized_status = "running" if fresh_heartbeat else "starting"
            elif active_state == "activating":
                normalized_status = "starting"
            elif active_state == "deactivating":
                normalized_status = "stopping"
            elif active_state in {"inactive", "dead"}:
                normalized_status = "stopped"
            elif active_state == "failed":
                normalized_status = "error"
            elif preserve_starting:
                normalized_status = "starting"
            else:
                normalized_status = (
                    previous_status
                    if previous_status
                    in {
                        "stopped",
                        "starting",
                        "running",
                        "error",
                        "stopping",
                        "scheduled",
                    }
                    else "stopped"
                )

            state_dirty = False
            running = normalized_status == "running"
            heartbeat_updated_at = (
                get_runtime_heartbeat_datetime(heartbeat_payload, "updated_at")
                if fresh_heartbeat
                else None
            )
            legacy_restart_message = bool(
                stream.error_message and "auto-restart" in stream.error_message.lower()
            )
            error_payload = info.get("error") or info.get("details")
            compact_error_payload = (
                " ".join(str(error_payload).split()) if error_payload else None
            )
            resolved_error_message = None
            if normalized_status == "error":
                resolved_error_message = (
                    f"Runtime state {active_state}: {compact_error_payload}"
                    if compact_error_payload
                    else f"Runtime state {active_state}"
                )[:500]

            if normalized_status == "starting":
                if aware_datetime(stream.started_at) is not None:
                    stream.started_at = None
                    state_dirty = True
                if stream.stopped_at is not None:
                    stream.stopped_at = None
                    state_dirty = True
                if stream.error_message:
                    stream.error_message = None
                    state_dirty = True
            elif running:
                if (
                    previous_status == "starting"
                    or aware_datetime(stream.started_at) is None
                ):
                    stream.started_at = heartbeat_updated_at or _utcnow()
                    state_dirty = True
                if stream.stopped_at is not None:
                    stream.stopped_at = None
                    state_dirty = True
                if stream.error_message:
                    stream.error_message = None
                    state_dirty = True
                if fresh_heartbeat:
                    if (
                        heartbeat_updated_at
                        and stream.runtime_last_heartbeat_at != heartbeat_updated_at
                    ):
                        stream.runtime_last_heartbeat_at = heartbeat_updated_at
                        state_dirty = True
            elif legacy_restart_message and stream.error_message is not None:
                stream.error_message = None
                state_dirty = True

            status_changed = normalized_status != previous_status
            if status_changed:
                stream.status = normalized_status
                state_dirty = True
                if normalized_status in {"stopped", "error"}:
                    stream.pid = None
                    if stream.stopped_at is None:
                        stream.stopped_at = _utcnow()
                elif normalized_status == "stopping":
                    stream.pid = None

            if (
                normalized_status == "error"
                and resolved_error_message
                and (
                    status_changed or not stream.error_message or legacy_restart_message
                )
            ):
                if stream.error_message != resolved_error_message:
                    stream.error_message = resolved_error_message
                    state_dirty = True

            if state_dirty:
                await self.db.commit()

            uptime_seconds = compute_uptime_seconds(stream) if running else 0
            error_message = None if preserve_scheduled else stream.error_message
            if normalized_status in {"running", "starting", "stopping"}:
                error_message = (
                    None if normalized_status == "starting" else error_message
                )
            elif normalized_status == "error" and not error_message:
                error_message = info.get("error") or info.get("details")
            return self._status_payload(
                stream,
                running,
                uptime_seconds,
                status_override=stream.status,
                error_message=error_message,
                usage=usage,
                manager_info=None,
            )

        is_running = self.manager.is_running(str(stream_id))
        stream_info = self.manager.get_stream_info(str(stream_id))
        uptime_seconds = 0
        if is_running and stream_info and "uptime_seconds" in stream_info:
            uptime_seconds = stream_info["uptime_seconds"]
        usage = await self._get_usage_snapshot()
        return self._status_payload(
            stream,
            is_running,
            uptime_seconds,
            usage=usage,
            manager_info=stream_info,
        )

    async def get_stream_logs(
        self, stream_id: UUID, lines: int, *, mode: str = "important"
    ) -> StreamLogsResponse:
        stream = await self._get_stream_basic(stream_id)
        if not stream.log_path or not Path(stream.log_path).exists():
            return StreamLogsResponse(stream_id=stream_id, logs=[], total_lines=0)

        log_file = Path(stream.log_path)

        def _read_log_tail(path: Path, limit: int) -> tuple[list[str], int]:
            total = 0
            tail: deque[str] = deque(maxlen=limit)
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    total += 1
                    tail.append(line.rstrip("\n\r"))
            return list(tail), total

        try:
            last_lines, total_lines = await asyncio.to_thread(
                _read_log_tail, log_file, lines
            )
        except FileNotFoundError:
            return StreamLogsResponse(stream_id=stream_id, logs=[], total_lines=0)

        normalized_mode = (mode or "important").strip().lower()
        if normalized_mode not in {"important", "raw"}:
            normalized_mode = "important"

        if normalized_mode == "important":
            last_lines = filter_important_ffmpeg_logs(last_lines)

        return StreamLogsResponse(
            stream_id=stream_id,
            logs=last_lines,
            total_lines=total_lines,
        )

    def _status_payload(
        self,
        stream: Stream,
        is_running: bool,
        uptime_seconds: Optional[int] = None,
        *,
        status_override: Optional[str] = None,
        error_message: Optional[str] = None,
        usage: Optional[Dict[str, Any]] = None,
        manager_info: Optional[Dict[str, Any]] = None,
    ) -> StreamStatus:
        """Project (stream, runtime info) into a StreamStatus DTO.

        Sprint 8.2 thin façade — body lives in
        ``control_helpers.build_status_payload``. Behavior unchanged.
        """
        return build_status_payload(
            stream,
            is_running,
            uptime_seconds,
            settings_provider=self.settings,
            status_override=status_override,
            error_message=error_message,
            usage=usage,
            manager_info=manager_info,
        )

    async def _get_usage_snapshot(
        self,
        enforcer: Optional[DefaultQuotaEnforcer] = None,
    ) -> Dict[str, Any]:
        candidate = enforcer or self.quota_cls(self.db, self.user_id)
        try:
            return await candidate.get_daily_streaming_usage()
        except HTTPException as exc:
            if (
                exc.status_code == status.HTTP_400_BAD_REQUEST
                and exc.detail
                == missing_tier_limits_detail(
                    getattr(candidate._profile, "subscription_tier", None)
                )
            ):
                return {}
            raise
        except Exception:
            return {}

    async def _stop_for_runtime(self, stream: Stream) -> None:
        if systemd_enabled():
            if await systemd_is_active(stream.id):
                await self._mark_stop_requested(stream)
                try:
                    await systemd_stop_unit(stream.id)
                except RuntimeError as err:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=str(err),
                    ) from err
        else:
            if self.manager.is_running(str(stream.id)):
                stream.status = "stopping"
                stream.pid = None
                await self.db.flush()
                await self.manager.stop_stream(str(stream.id))

        self._finalize_stopped(stream)

    async def _mark_stop_requested(self, stream: Stream) -> None:
        if stream.status != "stopping":
            stream.status = "stopping"
            stream.pid = None
            await self.db.commit()

    @staticmethod
    def _build_stop_audit_metadata(
        self,
        stream: Stream,
        *,
        source: str,
        actor_user_id: UUID | None,
        reason: str | None,
        metadata: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Sprint 8.2 thin façade — see control_helpers.build_stop_audit_metadata."""
        return build_stop_audit_metadata(
            stream,
            source=source,
            actor_user_id=actor_user_id,
            reason=reason,
            metadata=metadata,
        )

    async def _record_stop_audit(
        self,
        stream: Stream,
        *,
        phase: str,
        metadata: Dict[str, Any],
    ) -> None:
        event_metadata = dict(metadata)
        event_metadata["phase"] = phase
        event_metadata["status"] = stream.status

        if phase == "requested":
            message = f"Stop requested via {metadata['source']}."
        else:
            message = f"Stream stopped via {metadata['source']}."

        if metadata.get("reason"):
            message = f"{message[:-1]} (reason: {metadata['reason']})."

        await record_stream_audit_event(
            self.db,
            stream,
            level="info",
            message=message,
            metadata=event_metadata,
        )

    def _build_stop_activity_payload(
        self, stream: Stream, *, metadata: Dict[str, Any]
    ) -> Dict[str, Any] | None:
        """Sprint 8.2 thin façade — see control_helpers.build_stop_activity_payload."""
        return build_stop_activity_payload(stream, metadata=metadata)

    async def _persist_stop_request_attribution(
        self,
        stream: Stream,
        *,
        metadata: Dict[str, Any],
    ) -> None:
        event_metadata = dict(metadata)
        event_metadata["phase"] = "requested"
        event_metadata["status"] = stream.status

        message = f"Stop requested via {metadata['source']}."
        if metadata.get("reason"):
            message = f"{message[:-1]} (reason: {metadata['reason']})."

        await persist_stream_audit_event(
            stream.id,
            level="info",
            message=message,
            metadata=event_metadata,
            log_path=stream.log_path,
            activity_payload=self._build_stop_activity_payload(
                stream, metadata=metadata
            ),
        )

    async def _persist_stop_failure_attribution(
        self,
        *,
        stream_snapshot: Dict[str, Any],
        metadata: Dict[str, Any],
        error_message: str,
    ) -> None:
        event_metadata = dict(metadata)
        event_metadata["phase"] = "failed"
        event_metadata["status"] = stream_snapshot["status"]
        event_metadata["error"] = error_message[:500]

        message = f"Stop via {metadata['source']} failed before completion."
        if metadata.get("reason"):
            message = (
                f"{message[:-1]} (reason: {metadata['reason']}, "
                f"error: {error_message[:160]})."
            )

        await persist_stream_audit_event(
            stream_snapshot["stream_id"],
            level="error",
            message=message,
            metadata=event_metadata,
            log_path=stream_snapshot["log_path"],
        )

    @staticmethod
    def _finalize_stopped(stream: Stream) -> None:
        """Sprint 8.2 thin façade — see control_helpers.finalize_stopped."""
        _helper_finalize_stopped(stream)

    async def _get_stream_basic(self, stream_id: UUID) -> Stream:
        query = select(Stream).where(
            Stream.id == stream_id, Stream.user_id == self.user_id
        )
        result = await self.db.execute(query)
        stream = result.scalar_one_or_none()
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found"
            )
        return stream

    async def _get_stream_basic_for_update(self, stream_id: UUID) -> Stream:
        query = (
            select(Stream)
            .where(Stream.id == stream_id, Stream.user_id == self.user_id)
            .with_for_update()
        )
        result = await self.db.execute(query)
        stream = result.scalar_one_or_none()
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found"
            )
        return stream

    async def _ensure_systemd_schedule_update_allowed(self, stream: Stream) -> None:
        info = await systemd_unit_status(stream.id)
        active_state = str(info.get("ActiveState") or "").lower()

        if active_state in {"active", "activating", "deactivating"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot schedule start while stream is running",
            )

        if not active_state and self._stream_may_still_be_live(stream):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot schedule start while runtime liveness cannot be verified",
            )

    def _stream_may_still_be_live(self, stream: Stream) -> bool:
        """Sprint 8.2 thin façade — see control_helpers.stream_may_still_be_live."""
        return _helper_stream_may_still_be_live(stream)

    @staticmethod
    def _clear_start_schedule(stream: Stream) -> None:
        """Sprint 8.2 thin façade — see control_helpers.clear_start_schedule."""
        _helper_clear_start_schedule(stream)

    @staticmethod
    def _clear_stop_schedule(stream: Stream) -> None:
        """Sprint 8.2 thin façade — see control_helpers.clear_stop_schedule."""
        _helper_clear_stop_schedule(stream)

    @staticmethod
    def _clear_schedule(stream: Stream) -> None:
        """Sprint 8.2 thin façade — see control_helpers.clear_schedule."""
        _helper_clear_schedule(stream)

    @staticmethod
    def _mark_restart_success(stream: Stream, *, orchestrated: bool) -> None:
        """Sprint 8.2 thin façade — see control_helpers.mark_restart_success."""
        _helper_mark_restart_success(stream, orchestrated=orchestrated)


__all__ = ["StreamControlService"]
