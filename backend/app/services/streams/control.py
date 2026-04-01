"""Runtime management for streams (start/stop/status/logs)."""

from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as default_settings
from app.core.quota import QuotaEnforcer as DefaultQuotaEnforcer
from app.core.stream_runtime_lease import (
    claim_stream_runtime_lease,
    clear_stream_runtime_lease,
)
from app.core.stream_runtime_restart import (
    clear_stream_runtime_restart_state,
    mark_stream_runtime_restart_dispatched,
)
from app.core.supervisor_control import (
    supervisor_enabled,
    is_running as supervisor_is_running,
    program_status as supervisor_program_status,
    remove_program as supervisor_remove_program,
    restart_program as supervisor_restart_program,
    start_program as supervisor_start_program,
    stop_program as supervisor_stop_program,
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
from app.schemas.api import (
    StreamLogsResponse,
    StreamQualityResponse,
    StreamRuntimeRestartInfo,
    StreamStatus,
    _stream_runtime_restart_state,
)
from app.streaming.ffmpeg_manager import ffmpeg_manager as default_ffmpeg_manager
from app.streaming.hot_swap import hot_swap_manager

from .helpers import (
    extract_stream_assets,
    load_stream_with_relations,
    prepare_stream_launch,
    validate_stream_launch_prerequisites,
)


class StreamControlService:
    """Coordinates FFmpeg/systemd/supervisor interactions for streams."""

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
        return not (systemd_enabled() or supervisor_enabled())

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
        await self._acquire_user_start_lock()
        enforcer = self.quota_cls(self.db, self.user_id)
        await enforcer.check_concurrent_streams()

        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found"
            )

        lease = await claim_stream_runtime_lease(
            self.db,
            stream_id,
            owner_id=self.settings.stream_runtime_node_id,
            ttl_seconds=self.settings.stream_runtime_lease_ttl_seconds,
        )
        if not lease.acquired:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=_runtime_lease_conflict_detail(lease.owner_id, lease.expires_at),
            )

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
            try:
                await systemd_start_unit(stream_id)
            except RuntimeError as err:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)
                ) from err
            stream.status = "running"
            stream.started_at = _utcnow()
            stream.stopped_at = None
            stream.error_message = None
            stream.log_path = str(log_file)
            if reset_restart_policy:
                clear_stream_runtime_restart_state(stream)
            else:
                mark_stream_runtime_restart_dispatched(stream)
            if not preserve_schedule:
                self._clear_start_schedule(stream)
            await self.db.commit()
            usage = await self._get_usage_snapshot(enforcer)
            return self._status_payload(stream, True, usage=usage)

        if supervisor_enabled():
            _, _, log_file = await validate_stream_launch_prerequisites(
                self.db,
                self.user_id,
                stream,
                quota_evaluator=enforcer,
                settings_obj=self.settings,
            )
            info = await supervisor_program_status(stream_id)
            if info.get("state") == "RUNNING":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Stream already running",
                )
            try:
                await supervisor_start_program(stream_id)
            except RuntimeError as err:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)
                ) from err
            stream.status = "running"
            stream.started_at = _utcnow()
            stream.stopped_at = None
            stream.error_message = None
            stream.log_path = str(log_file)
            if reset_restart_policy:
                clear_stream_runtime_restart_state(stream)
            else:
                mark_stream_runtime_restart_dispatched(stream)
            if not preserve_schedule:
                self._clear_start_schedule(stream)
            await self.db.commit()
            usage = await self._get_usage_snapshot(enforcer)
            return self._status_payload(stream, True, usage=usage)

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
                "playlist_id": str(stream.playlist_id) if stream.playlist_id else None,
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
        if reset_restart_policy:
            clear_stream_runtime_restart_state(stream)
        else:
            mark_stream_runtime_restart_dispatched(stream)
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

    async def _acquire_user_start_lock(self) -> None:
        lock_key = int.from_bytes(self.user_id.bytes[:8], byteorder="big", signed=False)
        if lock_key > (2**63 - 1):
            lock_key -= 2**64

        await self.db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": lock_key},
        )

    async def stop_stream(self, stream_id: UUID) -> StreamStatus:
        stream = await self._get_stream_basic(stream_id)
        was_scheduled = stream.status == "scheduled"
        await self._stop_for_runtime(stream)
        self._clear_stop_schedule(stream)
        if was_scheduled:
            self._clear_start_schedule(stream)
        await self.db.commit()
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

        lease = await claim_stream_runtime_lease(
            self.db,
            stream_id,
            owner_id=self.settings.stream_runtime_node_id,
            ttl_seconds=self.settings.stream_runtime_lease_ttl_seconds,
        )
        if not lease.acquired:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=_runtime_lease_conflict_detail(lease.owner_id, lease.expires_at),
            )

        if systemd_enabled():
            try:
                await systemd_restart_unit(stream_id)
            except RuntimeError as err:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)
                ) from err
            self._mark_restart_success(stream, orchestrated=orchestrated)
            await self.db.commit()
            return

        if supervisor_enabled():
            try:
                await supervisor_restart_program(stream_id)
            except RuntimeError as err:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)
                ) from err
            self._mark_restart_success(stream, orchestrated=orchestrated)
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
        if systemd_enabled() or supervisor_enabled():
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

    async def ensure_stopped(self, stream: Stream) -> None:
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
            clear_stream_runtime_lease(stream)
            clear_stream_runtime_restart_state(stream)
            self._clear_schedule(stream)
            return

        if supervisor_enabled():
            if await supervisor_is_running(stream.id):
                try:
                    await supervisor_stop_program(stream.id)
                except RuntimeError as err:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=str(err),
                    ) from err
            try:
                await supervisor_remove_program(stream.id)
            except RuntimeError as err:
                import logging

                logging.getLogger(__name__).warning(
                    "Failed to remove stream %s from supervisor: %s", stream.id, err
                )
            stream.status = "stopped"
            stream.pid = None
            stream.stopped_at = _utcnow()
            clear_stream_runtime_lease(stream)
            clear_stream_runtime_restart_state(stream)
            self._clear_schedule(stream)
            return

        if self.manager.is_running(str(stream.id)):
            await self.manager.stop_stream(str(stream.id))
        stream.status = "stopped"
        stream.pid = None
        stream.stopped_at = _utcnow()
        clear_stream_runtime_lease(stream)
        clear_stream_runtime_restart_state(stream)
        self._clear_schedule(stream)

    async def get_stream_status(self, stream_id: UUID) -> StreamStatus:
        stream = await self._get_stream_basic(stream_id)

        if systemd_enabled():
            is_running = await systemd_is_active(stream_id)
            info = await systemd_unit_status(stream_id)
            active_state = info.get("ActiveState", stream.status)
            uptime_seconds = _uptime_seconds(stream) if is_running else 0
            usage = await self._get_usage_snapshot()
            status_override = (
                stream.status
                if (stream.status == "scheduled" and not is_running)
                else active_state
            )
            return self._status_payload(
                stream,
                is_running,
                uptime_seconds,
                status_override=status_override,
                usage=usage,
            )

        if supervisor_enabled():
            info = await supervisor_program_status(stream_id)
            state = info.get("state", stream.status)

            raw_state = (state or "").lower()
            supervisor_status_map = {
                "running": "running",
                "backoff": "error",
                "fatal": "error",
                "error": "error",
                "starting": "starting",
                "stopping": "stopping",
                "stopped": "stopped",
                "exited": "stopped",
                "unknown": stream.status,
                "not_found": "stopped",
            }
            preserve_scheduled = stream.status == "scheduled" and raw_state in {
                "",
                "unknown",
                "not_found",
                "stopped",
                "exited",
            }
            normalized_status = (
                "scheduled"
                if preserve_scheduled
                else supervisor_status_map.get(
                    raw_state,
                    (
                        stream.status
                        if stream.status
                        in {
                            "stopped",
                            "starting",
                            "running",
                            "error",
                            "stopping",
                            "scheduled",
                        }
                        else "stopped"
                    ),
                )
            )

            running = normalized_status == "running"
            uptime_seconds = _uptime_seconds(stream) if running else 0

            status_changed = normalized_status != stream.status
            if status_changed:
                stream.status = normalized_status
                if running:
                    if not stream.started_at:
                        stream.started_at = _utcnow()
                    stream.stopped_at = None
                elif normalized_status in {"stopped", "error"}:
                    stream.pid = None
                    stream.stopped_at = _utcnow()
                    clear_stream_runtime_lease(stream)
                elif normalized_status == "stopping":
                    # Transitional state: do not mark stopped_at yet. The periodic reconciler
                    # will finalize once supervisor reports STOPPED/EXITED/NOT_FOUND.
                    stream.pid = None

                error_payload = info.get("error") or info.get("details")
                if normalized_status == "error" and error_payload:
                    stream.error_message = str(error_payload)[:500]

                await self.db.commit()

            error_message = (
                None
                if preserve_scheduled
                else (info.get("error") or stream.error_message)
            )
            usage = await self._get_usage_snapshot()
            return self._status_payload(
                stream,
                running,
                uptime_seconds,
                status_override=stream.status,
                error_message=error_message,
                usage=usage,
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
            last_lines = _filter_important_ffmpeg_logs(last_lines)

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
    ) -> StreamStatus:
        uptime = (
            uptime_seconds
            if uptime_seconds is not None
            else (_uptime_seconds(stream) if is_running else 0)
        )

        base_total = max(float(stream.total_duration_seconds or 0.0), 0.0)
        started_at = _aware(stream.started_at) if is_running else None
        live_duration = None
        if started_at:
            live_duration = max(0, int((_utcnow() - started_at).total_seconds()))

        total_duration = (
            int(base_total + (live_duration or 0))
            if live_duration is not None
            else int(base_total)
        )
        if not is_running:
            total_duration = int(base_total)

        daily_limit_seconds: Optional[int] = None
        remaining_daily_seconds: Optional[int] = None
        quota_limit_reached: Optional[bool] = None
        if usage:
            limit_seconds = usage.get("limit_seconds")
            if limit_seconds is not None:
                daily_limit_seconds = max(int(limit_seconds), 0)
                remaining_val = usage.get("remaining_seconds")
                if remaining_val is not None:
                    remaining_daily_seconds = max(int(remaining_val), 0)
                if "limit_reached" in usage:
                    quota_limit_reached = bool(usage["limit_reached"])
                elif remaining_daily_seconds is not None:
                    quota_limit_reached = remaining_daily_seconds <= 0

        status_value = status_override or stream.status
        error_value = stream.error_message if error_message is None else error_message

        return StreamStatus(
            id=stream.id,
            status=status_value,
            uptime_seconds=uptime,
            is_running=is_running,
            error_message=error_value,
            live_duration_seconds=live_duration,
            total_duration_seconds=total_duration,
            daily_limit_seconds=daily_limit_seconds,
            remaining_daily_seconds=remaining_daily_seconds,
            quota_limit_reached=quota_limit_reached,
            runtime_restart=_runtime_restart_payload(stream, status_value=status_value),
        )

    async def _get_usage_snapshot(
        self,
        enforcer: Optional[DefaultQuotaEnforcer] = None,
    ) -> Dict[str, Any]:
        candidate = enforcer or self.quota_cls(self.db, self.user_id)
        try:
            return await candidate.get_daily_streaming_usage()
        except HTTPException:
            raise
        except Exception:
            return {}

    async def _stop_for_runtime(self, stream: Stream) -> None:
        if systemd_enabled():
            if await systemd_is_active(stream.id):
                try:
                    await systemd_stop_unit(stream.id)
                except RuntimeError as err:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=str(err),
                    ) from err
        elif supervisor_enabled():
            if await supervisor_is_running(stream.id):
                try:
                    await supervisor_stop_program(stream.id)
                except RuntimeError as err:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=str(err),
                    ) from err
            try:
                await supervisor_remove_program(stream.id)
            except RuntimeError as err:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)
                ) from err
        else:
            if self.manager.is_running(str(stream.id)):
                await self.manager.stop_stream(str(stream.id))

        stream.status = "stopped"
        stream.pid = None
        stream.stopped_at = _utcnow()
        clear_stream_runtime_lease(stream)
        clear_stream_runtime_restart_state(stream)

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

    @staticmethod
    def _clear_start_schedule(stream: Stream) -> None:
        stream.scheduled_start_enabled = False
        stream.scheduled_start_time = None
        stream.scheduled_start_attempted_at = None

    @staticmethod
    def _clear_stop_schedule(stream: Stream) -> None:
        stream.scheduled_stop_time = None
        stream.scheduled_stop_attempted_at = None

    @staticmethod
    def _clear_schedule(stream: Stream) -> None:
        StreamControlService._clear_start_schedule(stream)
        StreamControlService._clear_stop_schedule(stream)

    @staticmethod
    def _mark_restart_success(stream: Stream, *, orchestrated: bool) -> None:
        stream.status = "starting"
        stream.stopped_at = None
        stream.error_message = None
        if orchestrated:
            mark_stream_runtime_restart_dispatched(stream)
        else:
            clear_stream_runtime_restart_state(stream)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _filter_important_ffmpeg_logs(lines: list[str]) -> list[str]:
    """Keep only the most important FFmpeg log lines for UI display.

    We intentionally hide frame progress spam so users see actionable warnings/errors.
    """
    keywords = (
        "error",
        "failed",
        "forbidden",
        "invalid",
        "denied",
        "fatal",
        "unable",
        "timeout",
        "timed out",
        "exiting",
        "signal",
        "connection",
        "disconnect",
        "broken pipe",
        "reset",
    )

    filtered: list[str] = []

    for raw in lines:
        line = (raw or "").strip()
        if not line:
            continue

        # Known noisy warnings on graceful shutdown that do not affect live stability.
        if "Failed to update header with correct duration" in line:
            continue
        if "Failed to update header with correct filesize" in line:
            continue

        # FFmpeg progress stats (very noisy)
        if (
            line.startswith("frame=")
            or line.startswith("size=")
            or line.startswith("fps=")
        ):
            continue
        if line.startswith("Press [q]"):
            continue

        lowered = line.lower()
        if any(token in lowered for token in keywords):
            filtered.append(line)

    return filtered


def _runtime_lease_conflict_detail(
    owner_id: Optional[str], expires_at: Optional[datetime]
) -> str:
    detail = "Stream is currently managed by another runtime node"
    if owner_id:
        detail += f" ({owner_id})"
    if expires_at:
        expiry = (
            expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
        )
        detail += f" until {expiry.astimezone(timezone.utc).isoformat()}"
    return detail + "."


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if not dt:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _uptime_seconds(stream: Stream) -> int:
    start = _aware(stream.started_at)
    if not start:
        return 0
    return max(0, int((_utcnow() - start).total_seconds()))


__all__ = ["StreamControlService"]


def _runtime_restart_payload(
    stream: Stream,
    *,
    status_value: Optional[str] = None,
) -> StreamRuntimeRestartInfo:
    attempts = max(int(stream.runtime_restart_attempts or 0), 0)
    effective_status = status_value or stream.status
    next_restart_at = _aware(stream.runtime_next_restart_at)
    return StreamRuntimeRestartInfo(
        enabled=bool(default_settings.stream_runtime_auto_restart_enabled),
        state=_stream_runtime_restart_state(
            status=effective_status,
            attempts=attempts,
            next_restart_at=next_restart_at,
        ),
        attempts=attempts,
        max_attempts=max(int(default_settings.stream_runtime_restart_max_attempts), 0),
        next_restart_at=next_restart_at,
        last_restart_at=_aware(stream.runtime_last_restart_at),
        last_failure_at=_aware(stream.runtime_last_failure_at),
    )
