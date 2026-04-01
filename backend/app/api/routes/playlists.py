"""Playlist API routes."""

from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.api.deps import require_user
from app.schemas.api import PlaylistCreate, PlaylistResponse, PlaylistUpdate
from app.services.playlists import PlaylistService

router = APIRouter()


def _get_service(user_deps: tuple) -> PlaylistService:
    db, user_id = user_deps
    return PlaylistService(db, user_id)


@router.get("/", response_model=List[PlaylistResponse])
async def list_playlists(user_deps: tuple = Depends(require_user)):
    """List playlists for current user."""

    service = _get_service(user_deps)
    return await service.list_playlists()


@router.post("/", response_model=PlaylistResponse, status_code=status.HTTP_201_CREATED)
async def create_playlist(
    playlist_data: PlaylistCreate,
    user_deps: tuple = Depends(require_user),
):
    """Create a playlist with items."""

    service = _get_service(user_deps)
    return await service.create_playlist(playlist_data)


@router.get("/{playlist_id}", response_model=PlaylistResponse)
async def get_playlist(
    playlist_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    """Retrieve playlist details."""

    service = _get_service(user_deps)
    return await service.get_playlist(playlist_id)


@router.put("/{playlist_id}", response_model=PlaylistResponse)
async def update_playlist(
    playlist_id: UUID,
    playlist_data: PlaylistUpdate,
    user_deps: tuple = Depends(require_user),
):
    """Update playlist metadata."""

    service = _get_service(user_deps)
    return await service.update_playlist(playlist_id, playlist_data)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_playlist(
    playlist_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    """Delete playlist if not in use."""

    service = _get_service(user_deps)
    await service.delete_playlist(playlist_id)


@router.post("/{playlist_id}/validate")
async def validate_playlist(
    playlist_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    """Validate asset compatibility for a playlist."""

    service = _get_service(user_deps)
    return await service.validate_playlist(playlist_id)
