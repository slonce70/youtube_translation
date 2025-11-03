from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenResponse)
async def login(credentials: LoginRequest):
    """Login with email/password via Supabase"""
    # TODO: Implement Supabase authentication
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Authentication not yet implemented"
    )


@router.post("/logout")
async def logout():
    """Logout user"""
    # TODO: Implement logout
    return {"message": "Logged out successfully"}


@router.get("/me")
async def get_current_user():
    """Get current user info"""
    # TODO: Implement get user
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Not yet implemented"
    )
