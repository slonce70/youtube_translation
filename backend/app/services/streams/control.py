"""Runtime management for streams (start/stop/status/logs)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as default_settings
from app.core.quota import QuotaEnforcer as DefaultQuotaEnforcer
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
from app.schemas.api import StreamLogsResponse, StreamQualityResponse, StreamStatus
from app.streaming.ffmpeg_manager import ffmpeg_manager as default_ffmpeg_manager

from .helpers import extract_stream_assets, load_stream_with_relations, prepare_stream_launch


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

    async def evaluate_quality(self, stream_id: UUID) -> StreamQualityResponse:
        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found")

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

    async def start_stream(self, stream_id: UUID) -> StreamStatus:
        enforcer = self.quota_cls(self.db, self.user_id)
        await enforcer.check_concurrent_streams()

        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found")

        if systemd_enabled():
            if await systemd_is_active(stream_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stream already running")
            try:
                await systemd_start_unit(stream_id)
            except RuntimeError as err:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)) from err
            stream.status = "running"
            stream.started_at = _utcnow()
            stream.stopped_at = None
            stream.error_message = None
            await self.db.commit()
            return self._status_payload(stream, True)

        if supervisor_enabled():
            info = await supervisor_program_status(stream_id)
            if info.get("state") == "RUNNING":
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stream already running")
            try:
                await supervisor_start_program(stream_id)
            except RuntimeError as err:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)) from err
            stream.status = "running"
            stream.started_at = _utcnow()
            stream.stopped_at = None
            stream.error_message = None
            await self.db.commit()
            return self._status_payload(stream, True)

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
        await self.db.commit()
        return self._status_payload(stream, True, info.get("uptime_seconds", 0))

    async def stop_stream(self, stream_id: UUID) -> StreamStatus:
        stream = await self._get_stream_basic(stream_id)
        await self._stop_for_runtime(stream)
        await self.db.commit()
        return self._status_payload(stream, False)

    async def restart_stream(self, stream_id: UUID, live_target: Optional[str] = None) -> None:
        stream = await load_stream_with_relations(self.db, self.user_id, stream_id)
        if not stream:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found")

        if systemd_enabled():
            try:
                await systemd_restart_unit(stream_id)
            except RuntimeError as err:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)) from err
            return

        if supervisor_enabled():
            try:
                await supervisor_restart_program(stream_id)
            except RuntimeError as err:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)) from err
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

    async def ensure_stopped(self, stream: Stream) -> None:
        if systemd_enabled():
            if await systemd_is_active(stream.id):
                try:
                    await systemd_stop_unit(stream.id)
                except RuntimeError as err:
                    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)) from err
            stream.status = "stopped"
            stream.pid = None
            stream.stopped_at = _utcnow()
            return

        if supervisor_enabled():
            if await supervisor_is_running(stream.id):
                try:
                    await supervisor_stop_program(stream.id)
                except RuntimeError as err:
                    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)) from err
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
            return

        if self.manager.is_running(str(stream.id)):
            await self.manager.stop_stream(str(stream.id))
        stream.status = "stopped"
        stream.pid = None
        stream.stopped_at = _utcnow()

    async def get_stream_status(self, stream_id: UUID) -> StreamStatus:
        stream = await self._get_stream_basic(stream_id)

        if systemd_enabled():
            is_running = await systemd_is_active(stream_id)
            info = await systemd_unit_status(stream_id)
            active_state = info.get("ActiveState", stream.status)
            uptime_seconds = _uptime_seconds(stream) if is_running else 0
            return StreamStatus(
                id=stream_id,
                status=active_state,
                uptime_seconds=uptime_seconds,
                is_running=is_running,
                error_message=stream.error_message,
            )

        if supervisor_enabled():
            info = await supervisor_program_status(stream_id)
            state = info.get("state", stream.status)
            running = state == "RUNNING"
            uptime_seconds = _uptime_seconds(stream) if running else 0

            db_status = stream.status
            supervisor_status = state.lower() if state else "unknown"
            if db_status != supervisor_status and supervisor_status != "unknown":
                stream.status = supervisor_status
                if not running and stream.started_at:
                    stream.stopped_at = _utcnow()
                    stream.pid = None
                elif running and not stream.started_at:
                    stream.started_at = _utcnow()
                await self.db.commit()

            return StreamStatus(
                id=stream_id,
                status=stream.status,
                uptime_seconds=uptime_seconds,
                is_running=running,
                error_message=info.get("error") or stream.error_message,
            )

        is_running = self.manager.is_running(str(stream_id))
        stream_info = self.manager.get_stream_info(str(stream_id))
        uptime_seconds = 0
        if is_running and stream_info and "uptime_seconds" in stream_info:
            uptime_seconds = stream_info["uptime_seconds"]

        return StreamStatus(
            id=stream_id,
            status=stream.status,
            uptime_seconds=uptime_seconds,
            is_running=is_running,
            error_message=stream.error_message,
        )

    async def get_stream_logs(self, stream_id: UUID, lines: int) -> StreamLogsResponse:
        stream = await self._get_stream_basic(stream_id)
        if not stream.log_path or not Path(stream.log_path).exists():
            return StreamLogsResponse(stream_id=stream_id, logs=[], total_lines=0)

        log_file = Path(stream.log_path)
        with open(log_file, "r", encoding="utf-8") as handle:
            all_lines = handle.readlines()
            last_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines

        return StreamLogsResponse(
            stream_id=stream_id,
            logs=[line.strip() for line in last_lines],
            total_lines=len(all_lines),
        )

    def _status_payload(
        self, stream: Stream, is_running: bool, uptime_seconds: Optional[int] = None
    ) -> StreamStatus:
        uptime = uptime_seconds if uptime_seconds is not None else (_uptime_seconds(stream) if is_running else 0)
        return StreamStatus(
            id=stream.id,
            status=stream.status,
            uptime_seconds=uptime,
            is_running=is_running,
            error_message=stream.error_message,
        )

    async def _stop_for_runtime(self, stream: Stream) -> None:
        if systemd_enabled():
            if await systemd_is_active(stream.id):
                try:
                    await systemd_stop_unit(stream.id)
                except RuntimeError as err:
                    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)) from err
        elif supervisor_enabled():
            if await supervisor_is_running(stream.id):
                try:
                    await supervisor_stop_program(stream.id)
                except RuntimeError as err:
                    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err)) from err
        else:
            if self.manager.is_running(str(stream.id)):
                await self.manager.stop_stream(str(stream.id))

        stream.status = "stopped"
        stream.pid = None
        stream.stopped_at = _utcnow()

    async def _get_stream_basic(self, stream_id: UUID) -> Stream:
        query = select(Stream).where(Stream.id == stream_id, Stream.user_id == self.user_id)
        result = await self.db.execute(query)
        stream = result.scalar_one_or_none()
        if not stream:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stream not found")
        return stream


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
