from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List
from pathlib import Path
from uuid import UUID
import logging

from app.api.deps import require_user
from app.models.database import Asset, Project
from app.schemas.api import AssetResponse, AssetCreate
from app.streaming.validator import VideoValidator
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Initialize validator
validator = VideoValidator(settings.ffprobe_bin)


@router.get("/", response_model=List[AssetResponse])
async def list_assets(
    project_id: UUID = None,
    user_deps: tuple = Depends(require_user)
):
    """List all video assets for current user"""
    db, user_id = user_deps
    
    try:
        # Build query
        query = select(Asset).join(Project).where(Project.user_id == user_id)
        
        if project_id:
            query = query.where(Asset.project_id == project_id)
        
        result = await db.execute(query)
        assets = result.scalars().all()
        
        return assets
        
    except Exception as e:
        logger.error(f"Error listing assets: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list assets"
        )


@router.post("/", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
async def create_asset(
    asset_data: AssetCreate,
    background_tasks: BackgroundTasks,
    user_deps: tuple = Depends(require_user)
):
    """
    Create asset record after file upload.
    Called by tusd webhook or after manual upload.
    """
    db, user_id = user_deps
    
    try:
        # Verify project belongs to user
        project_query = select(Project).where(
            Project.id == asset_data.project_id,
            Project.user_id == user_id
        )
        result = await db.execute(project_query)
        project = result.scalar_one_or_none()
        
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found"
            )
        
        # Create asset record
        asset = Asset(
            project_id=asset_data.project_id,
            filename=asset_data.filename,
            storage_path=asset_data.storage_path,
            size_bytes=asset_data.size_bytes,
            duration_seconds=asset_data.duration_seconds,
            meta=asset_data.meta,
            compatible_for_copy=asset_data.compatible_for_copy,
            validation_errors=asset_data.validation_errors
        )
        
        db.add(asset)
        await db.commit()
        await db.refresh(asset)
        
        logger.info(f"Created asset {asset.id} for user {user_id}")
        
        return asset
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating asset: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create asset"
        )


@router.post("/upload-complete")
async def handle_upload_complete(
    upload_data: dict = Body(...),
    background_tasks: BackgroundTasks = None
):
    """
    Webhook handler called by tusd when upload completes.
    Validates the file and creates asset record.
    """
    try:
        file_path = Path(upload_data.get("Storage", {}).get("Path", ""))
        
        if not file_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Uploaded file not found"
            )
        
        logger.info(f"Processing upload: {file_path}")
        
        # Validate file with ffprobe
        validation_result = await validator.validate_file(file_path)
        
        # Extract metadata
        meta = validation_result.get("meta", {})
        stream_info = validator.get_stream_info(meta)
        
        # Get file size
        size_bytes = file_path.stat().st_size
        
        # Return validation result
        # Frontend will call create_asset with this data
        return {
            "success": True,
            "file_path": str(file_path),
            "filename": file_path.name,
            "size_bytes": size_bytes,
            "compatible_for_copy": validation_result["compatible_for_copy"],
            "validation_errors": validation_result.get("validation_errors", []),
            "meta": stream_info
        }
        
    except Exception as e:
        logger.error(f"Error processing upload: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(
    asset_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Get asset details"""
    db, user_id = user_deps
    
    try:
        query = select(Asset).join(Project).where(
            Asset.id == asset_id,
            Project.user_id == user_id
        )
        result = await db.execute(query)
        asset = result.scalar_one_or_none()
        
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found"
            )
        
        return asset
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting asset: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get asset"
        )


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: UUID,
    user_deps: tuple = Depends(require_user)
):
    """Delete an asset and its file"""
    db, user_id = user_deps
    
    try:
        # Get asset
        query = select(Asset).join(Project).where(
            Asset.id == asset_id,
            Project.user_id == user_id
        )
        result = await db.execute(query)
        asset = result.scalar_one_or_none()
        
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found"
            )
        
        # Delete file from disk
        file_path = Path(asset.storage_path)
        if file_path.exists():
            file_path.unlink()
            logger.info(f"Deleted file: {file_path}")
        
        # Delete from database
        await db.execute(delete(Asset).where(Asset.id == asset_id))
        await db.commit()
        
        logger.info(f"Deleted asset {asset_id}")
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting asset: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete asset"
        )
