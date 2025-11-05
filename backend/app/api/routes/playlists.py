from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from typing import List
from uuid import UUID
import logging

from app.api.deps import require_user
from app.models.database import Playlist, PlaylistItem, Asset
from app.schemas.api import (
    PlaylistResponse,
    PlaylistCreate,
    PlaylistUpdate,
    PlaylistItemResponse,
)
from app.core.quota import QuotaEnforcer

logger = logging.getLogger(__name__)
router = APIRouter()


def _playlist_to_response(playlist: Playlist) -> PlaylistResponse:
    """Преобразует ORM-плейлист в Pydantic-модель без ленивых загрузок."""
    items = sorted(list(playlist.items or []), key=lambda item: item.position)
    item_models = [
        PlaylistItemResponse.model_validate(item, from_attributes=True)
        for item in items
    ]

    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        loop=playlist.loop,
        created_at=playlist.created_at,
        updated_at=playlist.updated_at,
        items=item_models,
    )


@router.get("/", response_model=List[PlaylistResponse])
async def list_playlists(
    user_deps: tuple = Depends(require_user)
):
    """List all playlists for current user"""
    db, user_id = user_deps
    
    try:
        query = (
            select(Playlist)
            .where(Playlist.user_id == user_id)
            .options(selectinload(Playlist.items))
        )
        
        result = await db.execute(query)
        playlists = result.scalars().unique().all()

        # Материализуем отношения до закрытия сессии
        responses = [_playlist_to_response(playlist) for playlist in playlists]
        
        return responses
        
    except Exception as e:
        logger.error(f"Error listing playlists: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list playlists"
        )


@router.post("/", response_model=PlaylistResponse, status_code=status.HTTP_201_CREATED)
async def create_playlist(
    playlist_data: PlaylistCreate,
    user_deps: tuple = Depends(require_user)
):
    """Create a new playlist"""
    db, user_id = user_deps
    
    try:
        # Check quota for playlists
        enforcer = QuotaEnforcer(db, user_id)
        await enforcer.check_playlists_limit()
        
        # Create playlist
        playlist = Playlist(
            user_id=user_id,
            name=playlist_data.name,
            description=playlist_data.description,
            loop=playlist_data.loop
        )
        
        db.add(playlist)
        await db.flush()  # Get playlist ID
        
        # Add playlist items
        for item_data in playlist_data.items:
            # Verify asset belongs to same user
            asset_query = select(Asset).where(
                Asset.id == item_data.asset_id,
                Asset.user_id == user_id
            )
            asset_result = await db.execute(asset_query)
            asset = asset_result.scalar_one_or_none()
            
            if not asset:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Asset {item_data.asset_id} not found"
                )
            
            item = PlaylistItem(
                playlist_id=playlist.id,
                asset_id=item_data.asset_id,
                position=item_data.position
            )
            db.add(item)
        
        await db.commit()
        await db.refresh(playlist, attribute_names=["items"])
        
        logger.info(f"Created playlist {playlist.id} for user {user_id}")
        
        return _playlist_to_response(playlist)
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating playlist: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create playlist"
        )


@router.get("/{playlist_id}", response_model=PlaylistResponse)
async def get_playlist(
    playlist_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Get playlist details with items"""
    db, user_id = user_deps
    
    try:
        query = (
            select(Playlist)
            .where(
                Playlist.id == playlist_id,
                Playlist.user_id == user_id
            )
            .options(selectinload(Playlist.items))
        )
        
        result = await db.execute(query)
        playlist = result.scalar_one_or_none()
        
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Playlist not found"
            )
        
        return _playlist_to_response(playlist)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting playlist: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get playlist"
        )


@router.put("/{playlist_id}", response_model=PlaylistResponse)
async def update_playlist(
    playlist_id: UUID,
    playlist_data: PlaylistUpdate,
    user_deps: tuple = Depends(require_user)
):
    """Update playlist"""
    db, user_id = user_deps
    
    try:
        # Get playlist
        query = (
            select(Playlist)
            .where(
                Playlist.id == playlist_id,
                Playlist.user_id == user_id
            )
            .options(selectinload(Playlist.items))
        )
        result = await db.execute(query)
        playlist = result.scalar_one_or_none()
        
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Playlist not found"
            )
        
        # Update fields
        if playlist_data.name is not None:
            playlist.name = playlist_data.name
        if playlist_data.description is not None:
            playlist.description = playlist_data.description
        if playlist_data.loop is not None:
            playlist.loop = playlist_data.loop
        
        await db.commit()
        await db.refresh(playlist, attribute_names=["items"])
        
        return _playlist_to_response(playlist)
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating playlist: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update playlist"
        )


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_playlist(
    playlist_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Delete playlist"""
    db, user_id = user_deps
    
    try:
        # Verify ownership
        query = select(Playlist).where(
            Playlist.id == playlist_id,
            Playlist.user_id == user_id
        )
        result = await db.execute(query)
        playlist = result.scalar_one_or_none()
        
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Playlist not found"
            )
        
        # Delete playlist (items will cascade)
        await db.execute(delete(Playlist).where(Playlist.id == playlist_id))
        await db.commit()
        
        logger.info(f"Deleted playlist {playlist_id}")
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting playlist: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete playlist"
        )


@router.post("/{playlist_id}/validate")
async def validate_playlist(
    playlist_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """
    Validate that all assets in playlist are compatible for streaming.
    Checks that all files have same video/audio parameters.
    """
    db, user_id = user_deps
    
    try:
        # Get playlist with items and assets
        query = (
            select(Playlist)
            .where(
                Playlist.id == playlist_id,
                Playlist.user_id == user_id
            )
            .options(
                selectinload(Playlist.items).selectinload(PlaylistItem.asset)
            )
        )
        
        result = await db.execute(query)
        playlist = result.scalar_one_or_none()
        
        if not playlist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Playlist not found"
            )
        
        # Prepare assets data for validation
        assets_data = [
            {
                "path": item.asset.storage_path,
                "meta": item.asset.meta,
                "asset_id": str(item.asset.id),
                "filename": item.asset.filename,
            }
            for item in sorted(playlist.items, key=lambda x: x.position)
        ]
        
        # Validate compatibility
        is_compatible, issues = PlaylistBuilder.validate_playlist_assets(assets_data)
        
        return {
            "playlist_id": playlist_id,
            "compatible": is_compatible,
            "assets_count": len(assets_data),
            "issues": issues,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validating playlist: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to validate playlist"
        )
