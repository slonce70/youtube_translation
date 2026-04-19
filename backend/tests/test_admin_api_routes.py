from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient
from fastapi import HTTPException

from app.api.routes import admin as admin_routes
from app.main import app


@pytest.fixture
async def api_client():
    async with AsyncClient(app=app, base_url="http://testserver") as client:
        yield client


@pytest.mark.asyncio
async def test_list_users_route_normalizes_filter_aliases(api_client):
    captured: dict[str, Any] = {}

    class FakeAdminService:
        async def list_users(
            self,
            *,
            tier: str | None,
            status_filter: str | None,
            suspended_filter: bool | None,
            limit: int,
            offset: int,
        ):
            captured.update(
                tier=tier,
                status_filter=status_filter,
                suspended_filter=suspended_filter,
                limit=limit,
                offset=offset,
            )
            return {
                "items": [],
                "summary": {"total": 0, "active": 0, "suspended": 0, "paid": 0},
            }

    async def override_admin_service():
        return FakeAdminService()

    app.dependency_overrides[admin_routes.get_admin_service] = override_admin_service
    try:
        response = await api_client.get(
            "/api/admin/users",
            params={
                "tier": "fhd_flow",
                "status": "active",
                "suspended": "false",
                "is_suspended": "true",
                "limit": 25,
                "offset": 5,
            },
        )
    finally:
        app.dependency_overrides.pop(admin_routes.get_admin_service, None)

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "summary": {"total": 0, "active": 0, "suspended": 0, "paid": 0},
    }
    assert captured == {
        "tier": "fhd_flow",
        "status_filter": "active",
        "suspended_filter": False,
        "limit": 25,
        "offset": 5,
    }


@pytest.mark.asyncio
async def test_admin_access_route_surfaces_access_denial(api_client):
    async def override_admin_service():
        raise HTTPException(status_code=403, detail="Admin access required")

    app.dependency_overrides[admin_routes.get_admin_service] = override_admin_service
    try:
        response = await api_client.get("/api/admin/access")
    finally:
        app.dependency_overrides.pop(admin_routes.get_admin_service, None)

    assert response.status_code == 403
    assert response.json() == {"detail": "Admin access required"}


@pytest.mark.asyncio
async def test_access_route_returns_admin_profile(api_client):
    admin_user_id = uuid4()

    class FakeAdminService:
        async def get_admin_access(self):
            return {
                "user_id": admin_user_id,
                "email": "admin@example.com",
                "full_name": "Admin User",
                "subscription_tier": "fhd_flow",
                "subscription_status": "active",
                "is_admin": True,
                "is_suspended": False,
            }

    async def override_admin_service():
        return FakeAdminService()

    app.dependency_overrides[admin_routes.get_admin_service] = override_admin_service
    try:
        response = await api_client.get("/api/admin/access")
    finally:
        app.dependency_overrides.pop(admin_routes.get_admin_service, None)

    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(admin_user_id),
        "email": "admin@example.com",
        "full_name": "Admin User",
        "subscription_tier": "fhd_flow",
        "subscription_status": "active",
        "is_admin": True,
        "is_suspended": False,
    }


@pytest.mark.asyncio
async def test_suspend_route_surfaces_admin_guardrail_errors(api_client):
    target_user_id = uuid4()

    class FakeAdminService:
        async def suspend_user(self, user_id, request):
            assert user_id == target_user_id
            assert request.reason == "Admin accounts cannot be suspended"
            raise HTTPException(status_code=400, detail="Cannot suspend another admin")

    async def override_admin_service():
        return FakeAdminService()

    app.dependency_overrides[admin_routes.get_admin_service] = override_admin_service
    try:
        response = await api_client.post(
            f"/api/admin/users/{target_user_id}/suspend",
            json={"reason": "Admin accounts cannot be suspended"},
        )
    finally:
        app.dependency_overrides.pop(admin_routes.get_admin_service, None)

    assert response.status_code == 400
    assert response.json() == {"detail": "Cannot suspend another admin"}
