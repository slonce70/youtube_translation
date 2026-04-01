"""Compatibility wrapper that keeps CSRF enabled for HTTP without breaking WebSockets."""

from __future__ import annotations

from starlette.types import Receive, Scope, Send
from starlette_csrf import CSRFMiddleware


class WebSocketSafeCSRFMiddleware(CSRFMiddleware):
    """Skip CSRF processing for non-HTTP scopes.

    starlette-csrf instantiates an HTTP `Request`, which raises for WebSocket
    scopes. We still want CSRF enforcement for regular requests, so only bypass
    the middleware when the connection type is not `http`.
    """

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        await super().__call__(scope, receive, send)
