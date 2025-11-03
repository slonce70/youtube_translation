from fastapi import Depends, HTTPException, status, Header
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import logging

from app.core.database import get_db
from supabase import create_client, Client
from app.core.config import settings

logger = logging.getLogger(__name__)

# Supabase client
supabase: Client = create_client(settings.supabase_url, settings.supabase_key)


async def get_current_user_id(
    authorization: Optional[str] = Header(None)
) -> str:
    """
    Get current user ID from Supabase JWT token.
    
    Args:
        authorization: Bearer token from Authorization header
        
    Returns:
        User ID (UUID string)
        
    Raises:
        HTTPException: If token is invalid or missing
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = authorization.replace("Bearer ", "")
    
    try:
        # Verify token with Supabase
        user = supabase.auth.get_user(token)
        
        if not user or not user.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        return user.user.id
        
    except Exception as e:
        logger.error(f"Error verifying token: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user_optional(
    authorization: Optional[str] = Header(None)
) -> Optional[str]:
    """
    Get current user ID if authenticated, None otherwise.
    For optional authentication endpoints.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    
    try:
        return await get_current_user_id(authorization)
    except HTTPException:
        return None


class UserDependency:
    """Dependency class for getting current user with database session"""
    
    def __init__(self, required: bool = True):
        self.required = required
    
    async def __call__(
        self,
        db: AsyncSession = Depends(get_db),
        authorization: Optional[str] = Header(None)
    ) -> tuple[AsyncSession, Optional[str]]:
        """
        Get database session and current user ID.
        
        Returns:
            Tuple of (db_session, user_id)
        """
        if self.required:
            user_id = await get_current_user_id(authorization)
        else:
            user_id = await get_current_user_optional(authorization)
        
        return db, user_id


# Dependency instances
require_user = UserDependency(required=True)
optional_user = UserDependency(required=False)
