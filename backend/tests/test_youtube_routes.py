from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.api.routes import youtube as youtube_routes
from app.main import app


@pytest.fixture
async def api_client():
    async with AsyncClient(app=app, base_url='http://testserver') as client:
        yield client


@pytest.mark.asyncio
async def test_youtube_oauth_start_returns_auth_url(api_client, monkeypatch):
    user_id = uuid4()

    async def fake_require_user():
        return object(), user_id

    async def fake_build_oauth_start(self, *, redirect_origin: str, redirect_path: str):
        assert redirect_origin == 'http://localhost:3000'
        assert redirect_path == '/dashboard/profile'
        return 'https://accounts.google.com/o/oauth2/v2/auth?state=test'

    app.dependency_overrides[youtube_routes.require_user] = fake_require_user
    monkeypatch.setattr(
        youtube_routes.YoutubeConnectionService,
        'build_oauth_start',
        fake_build_oauth_start,
    )

    try:
        response = await api_client.get(
            '/api/youtube/oauth/start',
            params={
                'redirect_origin': 'http://localhost:3000',
                'redirect_path': '/dashboard/profile',
            },
        )
    finally:
        app.dependency_overrides.pop(youtube_routes.require_user, None)

    assert response.status_code == 200
    assert response.json() == {
        'auth_url': 'https://accounts.google.com/o/oauth2/v2/auth?state=test'
    }


@pytest.mark.asyncio
async def test_list_youtube_connections_returns_service_payload(api_client, monkeypatch):
    user_id = uuid4()

    async def fake_require_user():
        return object(), user_id

    async def fake_list_connections(self):
        return [
            {
                'id': str(uuid4()),
                'youtube_channel_id': 'channel-1',
                'youtube_channel_title': 'Main channel',
                'scopes': ['https://www.googleapis.com/auth/youtube.readonly'],
                'created_at': '2026-04-06T11:00:00Z',
                'updated_at': '2026-04-06T11:00:00Z',
                'last_sync_at': None,
                'last_sync_error': None,
                'provider_status': 'unknown',
                'provider_viewers': None,
                'provider_last_checked_at': None,
                'provider_video_id': None,
            }
        ]

    app.dependency_overrides[youtube_routes.require_user] = fake_require_user
    monkeypatch.setattr(
        youtube_routes.YoutubeConnectionService,
        'list_connections',
        fake_list_connections,
    )

    try:
        response = await api_client.get('/api/youtube/connections')
    finally:
        app.dependency_overrides.pop(youtube_routes.require_user, None)

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]['youtube_channel_id'] == 'channel-1'
    assert payload[0]['provider_status'] == 'unknown'
