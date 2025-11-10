"""FastAPI middleware that records request latency metrics and structured logs."""

import time
from typing import Callable, Awaitable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.core.logging_config import get_logger
from app.core.metrics import track_api_error, track_api_request


class APIMetricsMiddleware(BaseHTTPMiddleware):
    """Middleware that tracks API latency/errors for observability dashboards."""

    def __init__(self, app):
        super().__init__(app)
        self.logger = get_logger(__name__)

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        start = time.perf_counter()
        path = request.url.path
        method = request.method

        try:
            response = await call_next(request)
            duration = time.perf_counter() - start
            track_api_request(duration)

            if response.status_code >= 500:
                track_api_error()
                log_method = self.logger.error
            elif response.status_code >= 400:
                log_method = self.logger.warning
            else:
                log_method = self.logger.info

            log_method(
                "API request processed",
                extra={
                    "path": path,
                    "method": method,
                    "status_code": response.status_code,
                    "duration_ms": round(duration * 1000, 3),
                },
            )
            return response
        except Exception:
            duration = time.perf_counter() - start
            track_api_request(duration)
            track_api_error()
            self.logger.exception(
                "API request failed",
                extra={
                    "path": path,
                    "method": method,
                    "duration_ms": round(duration * 1000, 3),
                },
            )
            raise
