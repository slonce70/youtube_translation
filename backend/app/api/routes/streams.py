from __future__ import annotations

import asyncio
import json
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException, WebSocket, WebSocketDisconnect
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
    StreamScheduleUpdate,
    StreamWsTokenResponse,
)
from app.services.streams import StreamControlService, StreamService
from app.services.streams.websocket import stream_ws_manager
from app.services.streams.ws_tokens import generate_ws_token, verify_ws_token
from app.streaming.ffmpeg_manager import ffmpeg_manager  # noqa: F401 - compatibility for tests

router = APIRouter()
WS_STATUS_POLL_SECONDS = 3


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


@router.post("/ws/token", response_model=StreamWsTokenResponse)
async def create_stream_ws_token(user_deps: tuple = Depends(require_user)):
    _, user_id = user_deps
    token, expires_at = generate_ws_token(user_id)
    return StreamWsTokenResponse(token=token, expires_at=expires_at)


@router.websocket("/ws/status")
async def stream_status_websocket(websocket: WebSocket):
    await websocket.accept()

    connected = False
    user_id: str | None = None
    try:
        auth_message = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        try:
            payload = json.loads(auth_message)
        except json.JSONDecodeError:
            await websocket.close(code=1003, reason="Expected JSON auth payload")
            return

        token = payload.get("token") if isinstance(payload, dict) else None
        if not token:
            await websocket.close(code=1008, reason="Missing WebSocket token")
            return

        user_id = str(verify_ws_token(token))
        await stream_ws_manager.connect(websocket, user_id)
        connected = True

        while True:
            try:
                snapshot = stream_ws_manager.snapshot_for_user(
                    user_id,
                    ffmpeg_manager.get_all_streams(),
                )
                await websocket.send_text(json.dumps({"type": "stream_update", "payload": snapshot}))
                await asyncio.sleep(WS_STATUS_POLL_SECONDS)
            except WebSocketDisconnect:
                break
            except RuntimeError:
                break
    except asyncio.TimeoutError:
        await websocket.close(code=1008, reason="WebSocket auth timeout")
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid WebSocket token")
    finally:
        if connected:
            stream_ws_manager.disconnect(websocket)


@router.patch("/{stream_id}", response_model=StreamResponse)
async def update_stream_schedule(
    stream_id: UUID,
    payload: StreamScheduleUpdate,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service, _ = _build_services(db, user_id)
    return await service.update_stream_schedule(stream_id, payload)


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
    mode: str = Query(
        default="important",
        description="Log mode: important (filtered) or raw (all lines)",
    ),
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    _, control = _build_services(db, user_id)
    return await control.get_stream_logs(stream_id, lines, mode=mode)


@router.delete("/{stream_id}", status_code=204)
async def delete_stream(stream_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    service, control = _build_services(db, user_id)
    await service.delete_stream(stream_id, control)
