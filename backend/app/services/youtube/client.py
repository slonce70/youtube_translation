from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from app.core.config import settings


class YoutubeOAuthConfigError(RuntimeError):
    """Raised when YouTube OAuth settings are incomplete."""


class YoutubeApiError(RuntimeError):
    """Raised when Google/YouTube APIs return an unusable response."""


@dataclass
class YoutubeTokenBundle:
    access_token: str
    refresh_token: Optional[str]
    expires_at: Optional[datetime]
    scopes: list[str]


class YoutubeClient:
    def __init__(self, settings_provider=settings):
        self.settings = settings_provider

    def _require_oauth_config(self) -> None:
        if not (
            self.settings.google_oauth_client_id
            and self.settings.google_oauth_client_secret
            and self.settings.google_oauth_redirect_uri
        ):
            raise YoutubeOAuthConfigError("Google OAuth settings are not configured")

    def build_authorization_url(self, *, state: str) -> str:
        self._require_oauth_config()
        params = {
            "client_id": self.settings.google_oauth_client_id,
            "redirect_uri": self.settings.google_oauth_redirect_uri,
            "response_type": "code",
            "scope": " ".join(self.settings.google_oauth_scope_list),
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
        }
        return f"{self.settings.google_oauth_authorize_url}?{urlencode(params)}"

    async def exchange_code(self, code: str) -> YoutubeTokenBundle:
        self._require_oauth_config()
        payload = {
            "code": code,
            "client_id": self.settings.google_oauth_client_id,
            "client_secret": self.settings.google_oauth_client_secret,
            "redirect_uri": self.settings.google_oauth_redirect_uri,
            "grant_type": "authorization_code",
        }
        data = await self._post_form(self.settings.google_oauth_token_url, payload)
        return self._parse_token_bundle(data)

    async def refresh_access_token(self, refresh_token: str) -> YoutubeTokenBundle:
        self._require_oauth_config()
        payload = {
            "client_id": self.settings.google_oauth_client_id,
            "client_secret": self.settings.google_oauth_client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        data = await self._post_form(self.settings.google_oauth_token_url, payload)
        parsed = self._parse_token_bundle(data)
        if not parsed.refresh_token:
            parsed.refresh_token = refresh_token
        return parsed

    async def fetch_channel_identity(
        self, access_token: str
    ) -> dict[str, Optional[str]]:
        data = await self._get_json(
            "/channels",
            access_token,
            {"part": "id,snippet", "mine": "true", "maxResults": "1"},
        )
        items = data.get("items") or []
        if not items:
            raise YoutubeApiError("YouTube channel identity was not returned")
        item = items[0]
        snippet = item.get("snippet") or {}
        return {
            "channel_id": item.get("id"),
            "channel_title": snippet.get("title"),
        }

    async def fetch_active_broadcast(
        self, access_token: str
    ) -> Optional[dict[str, Any]]:
        data = await self._get_json(
            "/liveBroadcasts",
            access_token,
            {
                "part": "id,snippet,status,contentDetails",
                "broadcastStatus": "active",
                "mine": "true",
                "maxResults": "1",
            },
        )
        items = data.get("items") or []
        return items[0] if items else None

    async def fetch_video_live_details(
        self, access_token: str, video_id: str
    ) -> dict[str, Any]:
        data = await self._get_json(
            "/videos",
            access_token,
            {"part": "liveStreamingDetails", "id": video_id},
        )
        items = data.get("items") or []
        if not items:
            raise YoutubeApiError("YouTube video live details were not returned")
        return items[0].get("liveStreamingDetails") or {}

    async def fetch_live_stream_status(
        self, access_token: str, stream_id: str
    ) -> dict[str, Any]:
        data = await self._get_json(
            "/liveStreams",
            access_token,
            {"part": "status", "id": stream_id},
        )
        items = data.get("items") or []
        if not items:
            raise YoutubeApiError("YouTube live stream status was not returned")
        return items[0].get("status") or {}

    async def _post_form(self, url: str, payload: dict[str, str]) -> dict[str, Any]:
        async with httpx.AsyncClient(
            timeout=self.settings.youtube_provider_http_timeout_seconds
        ) as client:
            response = await client.post(url, data=payload)
        try:
            data = response.json()
        except ValueError:
            data = {"error": response.text}
        if response.status_code >= 400:
            raise YoutubeApiError(str(data))
        return data

    async def _get_json(
        self, path: str, access_token: str, params: dict[str, str]
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(
            base_url=self.settings.youtube_api_base_url,
            timeout=self.settings.youtube_provider_http_timeout_seconds,
            headers={"Authorization": f"Bearer {access_token}"},
        ) as client:
            response = await client.get(path, params=params)
        try:
            data = response.json()
        except ValueError:
            data = {"error": response.text}
        if response.status_code >= 400:
            raise YoutubeApiError(str(data))
        return data

    @staticmethod
    def _parse_token_bundle(data: dict[str, Any]) -> YoutubeTokenBundle:
        access_token = data.get("access_token")
        if not access_token:
            raise YoutubeApiError(
                "Google OAuth token response did not include access_token"
            )
        expires_in = data.get("expires_in")
        expires_at = None
        if isinstance(expires_in, (int, float)):
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        scope_str = data.get("scope") or ""
        scopes = [scope for scope in scope_str.split(" ") if scope]
        return YoutubeTokenBundle(
            access_token=access_token,
            refresh_token=data.get("refresh_token"),
            expires_at=expires_at,
            scopes=scopes,
        )
