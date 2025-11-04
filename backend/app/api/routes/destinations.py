from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List
from uuid import UUID
import logging

from app.api.deps import require_user
from app.models.database import Destination
from app.schemas.api import DestinationResponse, DestinationCreate, DestinationUpdate
from app.core.security import encrypt_stream_key, decrypt_stream_key, mask_stream_key
from app.core.quota import QuotaEnforcer

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
async def list_destinations(
    user_deps: tuple = Depends(require_user)
):
    """List all YouTube destinations for current user"""
    db, user_id = user_deps
    
    try:
        query = select(Destination).where(Destination.user_id == user_id)
        
        result = await db.execute(query)
        destinations = result.scalars().all()
        
        # Mask stream keys in response
        response_destinations = []
        for dest in destinations:
            dest_dict = {
                "id": str(dest.id),
                "name": dest.name,
                "rtmps_url": dest.rtmps_url,
                "enabled": dest.enabled,
                "stream_key_masked": mask_stream_key(dest.stream_key_encrypted),
                "created_at": dest.created_at.isoformat(),
                "updated_at": dest.updated_at.isoformat()
            }
            response_destinations.append(dest_dict)
        
        return response_destinations
        
    except Exception as e:
        logger.exception(f"Error listing destinations: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list destinations: {str(e)}"
        )


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_destination(
    destination_data: DestinationCreate,
    user_deps: tuple = Depends(require_user)
):
    """Add a new YouTube channel destination with encrypted stream key"""
    db, user_id = user_deps
    
    logger.info(f"Creating destination with data: {destination_data.model_dump()}")
    
    try:
        # Check quota for destinations
        enforcer = QuotaEnforcer(db, user_id)
        await enforcer.check_destinations_limit()
        await enforcer.ensure_destination_allowed(destination_data.rtmps_url)

        # Encrypt stream key
        encrypted_key = encrypt_stream_key(destination_data.stream_key)
        
        # Create destination
        destination = Destination(
            user_id=user_id,
            name=destination_data.name,
            rtmps_url=destination_data.rtmps_url,
            stream_key_encrypted=encrypted_key,
            enabled=destination_data.enabled
        )
        
        db.add(destination)
        await db.commit()
        await db.refresh(destination)
        
        logger.info(f"Created destination {destination.id} for user {user_id}")
        
        # Return with masked key
        return {
            "id": str(destination.id),
            "name": destination.name,
            "rtmps_url": destination.rtmps_url,
            "enabled": destination.enabled,
            "stream_key_masked": mask_stream_key(encrypted_key),
            "created_at": destination.created_at.isoformat(),
            "updated_at": destination.updated_at.isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error creating destination: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create destination: {str(e)}"
        )


@router.get("/{destination_id}")
async def get_destination(
    destination_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Get destination details (stream key is masked)"""
    db, user_id = user_deps
    
    try:
        query = select(Destination).where(
            Destination.id == destination_id,
            Destination.user_id == user_id
        )
        result = await db.execute(query)
        destination = result.scalar_one_or_none()
        
        if not destination:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Destination not found"
            )
        
        return {
            "id": str(destination.id),
            "name": destination.name,
            "rtmps_url": destination.rtmps_url,
            "enabled": destination.enabled,
            "stream_key_masked": mask_stream_key(destination.stream_key_encrypted),
            "created_at": destination.created_at.isoformat(),
            "updated_at": destination.updated_at.isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting destination: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get destination: {str(e)}"
        )


@router.put("/{destination_id}")
async def update_destination(
    destination_id: UUID,
    destination_data: DestinationUpdate,
    user_deps: tuple = Depends(require_user)
):
    """Update destination"""
    db, user_id = user_deps
    
    logger.info(f"Updating destination {destination_id} with data: {destination_data.model_dump(exclude_unset=True)}")
    
    try:
        # Get destination
        query = select(Destination).where(
            Destination.id == destination_id,
            Destination.user_id == user_id
        )
        result = await db.execute(query)
        destination = result.scalar_one_or_none()

        if not destination:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Destination not found"
            )

        enforcer = QuotaEnforcer(db, user_id)
        await enforcer.check_suspended()

        # Update fields (only if provided)
        if destination_data.name is not None:
            destination.name = destination_data.name
        if destination_data.rtmps_url is not None:
            await enforcer.ensure_destination_allowed(destination_data.rtmps_url)
            destination.rtmps_url = destination_data.rtmps_url
        if destination_data.stream_key is not None and destination_data.stream_key.strip():
            # Re-encrypt new key only if it's not empty
            destination.stream_key_encrypted = encrypt_stream_key(destination_data.stream_key)
        if destination_data.enabled is not None:
            destination.enabled = destination_data.enabled
        
        await db.commit()
        await db.refresh(destination)
        
        return {
            "id": str(destination.id),
            "name": destination.name,
            "rtmps_url": destination.rtmps_url,
            "enabled": destination.enabled,
            "stream_key_masked": mask_stream_key(destination.stream_key_encrypted),
            "created_at": destination.created_at.isoformat(),
            "updated_at": destination.updated_at.isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error updating destination: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update destination: {str(e)}"
        )


@router.delete("/{destination_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_destination(
    destination_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Delete destination"""
    db, user_id = user_deps
    
    try:
        # Verify ownership
        query = select(Destination).where(
            Destination.id == destination_id,
            Destination.user_id == user_id
        )
        result = await db.execute(query)
        destination = result.scalar_one_or_none()
        
        if not destination:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Destination not found"
            )
        
        # Delete destination
        await db.execute(delete(Destination).where(Destination.id == destination_id))
        await db.commit()
        
        logger.info(f"Deleted destination {destination_id}")
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error deleting destination: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete destination: {str(e)}"
        )
