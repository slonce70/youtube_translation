from typing import Any, Dict, Optional

import pytest
from httpx import AsyncClient
from supabase import AuthInvalidCredentialsError

from app.api.routes import auth as auth_routes
from app.main import app


class DummySession:
    def __init__(self):
        self.access_token = "access-token"
        self.refresh_token = "refresh-token"
        self.token_type = "bearer"
        self.expires_in = 3600


class DummyAuthResponse:
    def __init__(self, session=None):
        self.session = session or DummySession()


class DummyAuthAdmin:
    def __init__(self):
        self.calls = []

    def sign_out(self, token: str, scope: str):
        self.calls.append((token, scope))


class DummyAuth:
    def __init__(self, *, raise_error: Optional[Exception] = None):
        self.raise_error = raise_error
        self.credentials: Optional[Dict[str, Any]] = None
        self.admin = DummyAuthAdmin()

    def sign_in_with_password(self, credentials: Dict[str, Any]):
        if self.raise_error:
            raise self.raise_error
        self.credentials = credentials
        return DummyAuthResponse()


class DummySupabaseClient:
    def __init__(self, auth: DummyAuth):
        self.auth = auth


@pytest.fixture
async def api_client():
    async with AsyncClient(app=app, base_url="http://testserver") as client:
        yield client


@pytest.mark.asyncio
async def test_login_success(api_client, monkeypatch):
    dummy_auth = DummyAuth()
    monkeypatch.setattr(
        auth_routes,
        "_create_supabase_client",
        lambda: DummySupabaseClient(dummy_auth),
    )

    response = await api_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "secret"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["access_token"] == "access-token"
    assert payload["refresh_token"] == "refresh-token"
    assert dummy_auth.credentials == {
        "email": "user@example.com",
        "password": "secret",
    }


@pytest.mark.asyncio
async def test_login_invalid_credentials(api_client, monkeypatch):
    dummy_auth = DummyAuth(raise_error=AuthInvalidCredentialsError("Invalid login credentials"))
    monkeypatch.setattr(
        auth_routes,
        "_create_supabase_client",
        lambda: DummySupabaseClient(dummy_auth),
    )

    response = await api_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "wrong"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


@pytest.mark.asyncio
async def test_logout_revokes_token(api_client, monkeypatch):
    dummy_auth = DummyAuth()
    monkeypatch.setattr(
        auth_routes,
        "_create_supabase_client",
        lambda: DummySupabaseClient(dummy_auth),
    )

    captured_token = {}

    def fake_invalidate(token: Optional[str]):
        captured_token["value"] = token

    monkeypatch.setattr(auth_routes, "invalidate_cached_user", fake_invalidate)

    response = await api_client.post(
        "/api/auth/logout",
        headers={"Authorization": "Bearer access-token"},
    )

    assert response.status_code == 200
    assert dummy_auth.admin.calls == [("access-token", "global")]
    assert captured_token["value"] == "access-token"


@pytest.mark.asyncio
async def test_logout_without_header_fails(api_client):
    response = await api_client.post("/api/auth/logout")
    assert response.status_code == 401
    assert response.json()["detail"] == "Missing authorization header"


@pytest.mark.asyncio
async def test_get_current_user_success(api_client):
    def override_get_current_user():
        return {
            "sub": "user-id",
            "email": "user@example.com",
            "user_metadata": {"role": "admin"},
        }

    app.dependency_overrides[auth_routes.get_current_user] = override_get_current_user

    try:
        response = await api_client.get("/api/auth/me")
    finally:
        app.dependency_overrides.pop(auth_routes.get_current_user, None)

    assert response.status_code == 200
    assert response.json() == {
        "id": "user-id",
        "email": "user@example.com",
        "user_metadata": {"role": "admin"},
    }


@pytest.mark.asyncio
async def test_get_current_user_missing_sub(api_client):
    def override_missing_user():
        return {"email": "user@example.com"}

    app.dependency_overrides[auth_routes.get_current_user] = override_missing_user

    try:
        response = await api_client.get("/api/auth/me")
    finally:
        app.dependency_overrides.pop(auth_routes.get_current_user, None)

    assert response.status_code == 401
    assert response.json()["detail"] == "User ID not found in token"
