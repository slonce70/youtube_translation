from __future__ import annotations

import asyncio
import json
from typing import List
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    Query,
    HTTPException,
    Header,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_user
from app.api.request_context import extract_request_audit_metadata
from app.core.config import settings  # noqa: F401 - compatibility for tests
from app.core.logging_config import get_logger
from app.core.quota import QuotaEnforcer  # noqa: F401 - compatibility for tests
from app.schemas.api import (
    StreamCreate,
    StreamEventResponse,
    StreamLiveMetrics,
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
from app.streaming.ffmpeg_manager import (
    ffmpeg_manager,
)  # noqa: F401 - compatibility for tests

router = APIRouter()
WS_STATUS_POLL_SECONDS = 3
logger = get_logger(__name__)


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
async def create_stream(
    stream_data: StreamCreate, user_deps: tuple = Depends(require_user)
):
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
                await websocket.send_text(
                    json.dumps({"type": "stream_update", "payload": snapshot})
                )
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
async def stop_stream(
    stream_id: UUID,
    request: Request,
    authorization: str | None = Header(None),
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    user_payload = await get_current_user(authorization)
    _, control = _build_services(db, user_id)
    metadata = extract_request_audit_metadata(
        request, route_path=f"/api/streams/{stream_id}/stop", user_payload=user_payload
    )
    status_payload = await control.stop_stream(
        stream_id,
        source="user_api",
        actor_user_id=user_id,
        reason="user_requested_stop",
        metadata=metadata,
    )
    logger.info(
        "Stream stop request completed",
        extra={
            "path": f"/api/streams/{stream_id}/stop",
            "method": "POST",
            "request_id": metadata["request_id"],
            "user_id": str(user_id),
            "stream_id": str(stream_id),
            "status_code": 200,
        },
    )
    return status_payload


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
    lines: int = Query(
        default=100, ge=1, le=10_000, description="Number of log lines (1-10000)"
    ),
    mode: str = Query(
        default="important",
        description="Log mode: important (filtered) or raw (all lines)",
    ),
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    _, control = _build_services(db, user_id)
    return await control.get_stream_logs(stream_id, lines, mode=mode)


@router.get("/{stream_id}/events", response_model=List[StreamEventResponse])
async def get_stream_events(
    stream_id: UUID,
    limit: int = Query(default=50, ge=1, le=500),
    user_deps: tuple = Depends(require_user),
):
    """Track 5b/C #3: structured event timeline for the operator panel.

    Replaces the frontend's prior workaround of parsing the logs file
    via ``extractStopAuditEntries``. Filters to the user's streams via
    a join with the ``streams`` table to prevent cross-tenant reads.
    """
    from sqlalchemy import select
    from app.models.database import Stream, StreamEvent

    db, user_id = user_deps
    # Tenant guard: ensure the stream belongs to the requesting user.
    owns = await db.execute(
        select(Stream.id).where(Stream.id == stream_id, Stream.user_id == user_id)
    )
    if owns.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    rows = await db.execute(
        select(StreamEvent)
        .where(StreamEvent.stream_id == stream_id)
        .order_by(StreamEvent.created_at.desc())
        .limit(limit)
    )
    events = rows.scalars().all()
    return [
        StreamEventResponse(
            id=event.id,
            stream_id=event.stream_id,
            level=event.level,
            message=event.message,
            metadata=event.event_metadata,
            created_at=event.created_at,
        )
        for event in events
    ]


@router.get("/{stream_id}/metrics", response_model=StreamLiveMetrics)
async def get_stream_metrics(
    stream_id: UUID,
    samples: int = Query(default=60, ge=1, le=120),
    user_deps: tuple = Depends(require_user),
):
    """Track 5b/C #2: live FFmpeg-stderr metrics for sparklines.

    Returns the latest bitrate/fps + the last N samples (default 60 ≈ 1
    minute at 1 Hz). The sliding window lives in-memory in
    ``ffmpeg_metrics``; cleared on stream stop. Returns an empty
    payload (no samples) when the stream has never published a tick —
    e.g. between ``start_stream`` accepting and the first FFmpeg
    progress line landing.
    """
    from sqlalchemy import select
    from app.models.database import Stream
    from app.streaming.ffmpeg_metrics import ffmpeg_metrics

    db, user_id = user_deps
    owns = await db.execute(
        select(Stream.id).where(Stream.id == stream_id, Stream.user_id == user_id)
    )
    if owns.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    snap = ffmpeg_metrics.snapshot(str(stream_id), samples=samples)
    if snap is None:
        return StreamLiveMetrics()
    return StreamLiveMetrics(**snap)


@router.delete("/{stream_id}", status_code=204)
async def delete_stream(stream_id: UUID, user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    service, control = _build_services(db, user_id)
    await service.delete_stream(stream_id, control)
