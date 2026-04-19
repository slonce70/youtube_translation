from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

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
