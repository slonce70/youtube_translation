from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.api.deps import require_user
from app.schemas.api import DestinationCreate, DestinationResponse, DestinationUpdate
from app.services.destinations import DestinationService

router = APIRouter()


def _get_service(user_deps: tuple) -> DestinationService:
    db, user_id = user_deps
    return DestinationService(db, user_id)


def _dump_destination(response: DestinationResponse) -> dict:
    return response.model_dump()


@router.get("/", response_model=List[DestinationResponse])
async def list_destinations(
    user_deps: tuple = Depends(require_user),
):
    """List all YouTube destinations for current user."""

    responses = await _get_service(user_deps).list_destinations()
    return [_dump_destination(resp) for resp in responses]


@router.post(
    "/", status_code=status.HTTP_201_CREATED, response_model=DestinationResponse
)
async def create_destination(
    destination_data: DestinationCreate,
    user_deps: tuple = Depends(require_user),
):
    """Add a new YouTube channel destination with encrypted stream key."""

    response = await _get_service(user_deps).create_destination(destination_data)
    return _dump_destination(response)


@router.get("/{destination_id}", response_model=DestinationResponse)
async def get_destination(
    destination_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    """Get destination details (stream key is masked)."""

    response = await _get_service(user_deps).get_destination(destination_id)
    return _dump_destination(response)


@router.put("/{destination_id}", response_model=DestinationResponse)
async def update_destination(
    destination_id: UUID,
    destination_data: DestinationUpdate,
    user_deps: tuple = Depends(require_user),
):
    """Update destination."""

    response = await _get_service(user_deps).update_destination(
        destination_id, destination_data
    )
    return _dump_destination(response)


@router.delete("/{destination_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_destination(
    destination_id: UUID,
    user_deps: tuple = Depends(require_user),
):
    """Delete destination."""

    await _get_service(user_deps).delete_destination(destination_id)
