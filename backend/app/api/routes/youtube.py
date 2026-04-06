from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_user
from app.schemas.api import YoutubeConnectionResponse, YoutubeOAuthStartResponse
from app.services.youtube.client import YoutubeOAuthConfigError
from app.services.youtube.oauth_state import (
    YoutubeOAuthStateError,
    build_redirect_url,
    parse_oauth_state,
)
from app.services.youtube.service import YoutubeConnectionService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/oauth/start", response_model=YoutubeOAuthStartResponse)
async def youtube_oauth_start(
    redirect_origin: str = Query(..., min_length=1),
    redirect_path: str = Query("/dashboard/profile", min_length=1),
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    service = YoutubeConnectionService(db, user_id)
    try:
        auth_url = await service.build_oauth_start(
            redirect_origin=redirect_origin,
            redirect_path=redirect_path,
        )
    except (YoutubeOAuthConfigError, YoutubeOAuthStateError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return YoutubeOAuthStartResponse(auth_url=auth_url)


@router.get("/oauth/callback")
async def youtube_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    try:
        state_payload = parse_oauth_state(state or "")
        redirect_origin = state_payload["redirect_origin"]
        redirect_path = state_payload["redirect_path"]
    except YoutubeOAuthStateError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    if error:
        return RedirectResponse(
            build_redirect_url(
                redirect_origin,
                redirect_path,
                status="error",
                message=error,
            ),
            status_code=status.HTTP_302_FOUND,
        )

    if not code:
        return RedirectResponse(
            build_redirect_url(
                redirect_origin,
                redirect_path,
                status="error",
                message="missing_code",
            ),
            status_code=status.HTTP_302_FOUND,
        )

    try:
        service = YoutubeConnectionService(db, UUID(state_payload["sub"]))
        await service.upsert_connection_from_code(
            user_id=UUID(state_payload["sub"]),
            code=code,
        )
        await db.commit()
        redirect_url = build_redirect_url(
            redirect_origin,
            redirect_path,
            status="success",
        )
    except Exception as exc:
        await db.rollback()
        logger.warning("YouTube OAuth callback failed: %s", exc)
        redirect_url = build_redirect_url(
            redirect_origin,
            redirect_path,
            status="error",
            message="oauth_callback_failed",
        )
    return RedirectResponse(redirect_url, status_code=status.HTTP_302_FOUND)


@router.get("/connections", response_model=list[YoutubeConnectionResponse])
async def list_youtube_connections(user_deps: tuple = Depends(require_user)):
    db, user_id = user_deps
    return await YoutubeConnectionService(db, user_id).list_connections()


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_youtube_connection(
    connection_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    db, user_id = user_deps
    await YoutubeConnectionService(db, user_id).delete_connection(connection_id)
