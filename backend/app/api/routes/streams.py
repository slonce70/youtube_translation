from __future__ import annotations

import asyncio
import json
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException, WebSocket, WebSocketDisconnect, status  # noqa: F401
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_user
from app.core.config import settings  # noqa: F401 - compatibility for tests
from app.core.quota import QuotaEnforcer  # noqa: F401 - compatibility for tests
from app.schemas.api import (
    StreamCreate,
    StreamLiveUpdateRequest,
    StreamLogsResponse,
    StreamQualityResponse,
    StreamResponse,
    StreamStatus,
    StreamQueueAppend,
    StreamQueueResponse,
    StreamWsTokenResponse,
)
from app.services.streams import StreamControlService, StreamService
from app.services.streams.ws_tokens import generate_ws_token, verify_ws_token
from app.services.streams.websocket import stream_ws_manager
from app.streaming.ffmpeg_manager import ffmpeg_manager  # noqa: F401 - compatibility for tests

router = APIRouter()


@router.websocket("/ws/status")
async def websocket_stream_status(websocket: WebSocket):
    """
    WebSocket endpoint for real-time stream status updates.
    Clients receive JSON messages with the current state of their streams.
    """
    await websocket.accept()

    async def _read_auth_token() -> Optional[str]:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        except asyncio.TimeoutError:
            return None
        except Exception:
            return None
        raw = raw.strip()
        if not raw:
            return None
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if isinstance(payload, dict):
            message_type = payload.get("type")
            if message_type and message_type != "auth":
                return None
            candidate = payload.get("token") or payload.get("access_token")
            return candidate if isinstance(candidate, str) else None
        return None

    token = await _read_auth_token()

    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        user_id = str(verify_ws_token(token))
    except HTTPException:
        user_id = None

    if not user_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await stream_ws_manager.connect(websocket, user_id)
    try:
        await websocket.send_text(json.dumps({"type": "auth", "status": "ok"}))
    except Exception:
        pass
    try:
        while True:
            # Keep connection alive and handle client disconnects
            await websocket.receive_text()
    except WebSocketDisconnect:
        stream_ws_manager.disconnect(websocket)
    except Exception:
        stream_ws_manager.disconnect(websocket)


@router.post("/ws-token", response_model=StreamWsTokenResponse)
async def create_ws_token(user_deps: tuple = Depends(require_user)):
    _, user_id = user_deps
    token, expires_at = generate_ws_token(user_id)
    return StreamWsTokenResponse(token=token, expires_at=expires_at)


def _build_services(db: AsyncSession, user_id: UUID):
    """Convenience helper so endpoints construct both services consistently."""
    service = StreamService(db, user_id, settings_provider=settings)
    control = StreamControlService(
        db,
        user_id,
        quota_cls=QuotaEnforcer,
        manager=ffmpeg_manager,
        settings_module=settings,
    )
    return service, control


@router.get("/", response_model=List[StreamResponse])
async def list_streams(user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    service, _ = _build_services(db, user_id)
    return await service.list_streams()


@router.post("/", response_model=StreamResponse, status_code=201)
async def create_stream(stream_data: StreamCreate, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    service, _ = _build_services(db, user_id)
    return await service.create_stream(stream_data)


@router.get("/{stream_id}/quality", response_model=StreamQualityResponse)
async def stream_quality(stream_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    _, control = _build_services(db, user_id)
    return await control.evaluate_quality(stream_id)


@router.post("/{stream_id}/start", response_model=StreamStatus)
async def start_stream(stream_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    _, control = _build_services(db, user_id)
    return await control.start_stream(stream_id)


@router.patch("/{stream_id}/live-config", response_model=StreamResponse)
async def live_update_stream(
    stream_id: UUID,
    update: StreamLiveUpdateRequest,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service, control = _build_services(db, user_id)
    return await service.live_update_stream(stream_id, update, control)


@router.post("/{stream_id}/stop", response_model=StreamStatus)
async def stop_stream(stream_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    _, control = _build_services(db, user_id)
    return await control.stop_stream(stream_id)


@router.post("/{stream_id}/queue", response_model=StreamQueueResponse)
async def append_stream_queue(
    stream_id: UUID,
    payload: StreamQueueAppend,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service, control = _build_services(db, user_id)
    await service.enqueue_stream_asset(stream_id, payload, control)
    return StreamQueueResponse()


@router.get("/{stream_id}/status", response_model=StreamStatus)
async def get_stream_status(stream_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    _, control = _build_services(db, user_id)
    return await control.get_stream_status(stream_id)


@router.get("/{stream_id}/logs", response_model=StreamLogsResponse)
async def get_stream_logs(
    stream_id: UUID,
    lines: int = Query(default=100, ge=1, le=10_000, description="Number of log lines (1-10000)"),
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    _, control = _build_services(db, user_id)
    return await control.get_stream_logs(stream_id, lines)


@router.delete("/{stream_id}", status_code=204)
async def delete_stream(stream_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    service, control = _build_services(db, user_id)
    await service.delete_stream(stream_id, control)
