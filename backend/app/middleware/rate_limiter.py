"""
Rate limiting middleware for FastAPI

Protects API endpoints from brute force attacks and abuse.
Uses in-memory storage for simplicity (consider Redis for production).
"""

import time
import logging
import inspect
from collections import deque
from ipaddress import ip_address, ip_network
from urllib.parse import unquote
from typing import Dict, Tuple, Iterable, List
from threading import RLock
from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings

logger = logging.getLogger(__name__)

try:  # Optional dependency for Redis-backed rate limiting
    import redis.asyncio as redis  # type: ignore
except Exception:  # pragma: no cover - handled at runtime
    redis = None


class RateLimitEntry:
    """Track request history for a client"""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: deque = deque()

    def is_allowed(self) -> bool:
        """Check if request is allowed within rate limit"""
        now = time.time()

        # Remove old requests outside the window
        while self.requests and self.requests[0] < now - self.window_seconds:
            self.requests.popleft()

        # Check if limit exceeded
        if len(self.requests) >= self.max_requests:
            return False

        # Add current request
        self.requests.append(now)
        return True

    def get_remaining(self) -> int:
        """Get remaining requests in current window"""
        now = time.time()

        # Clean old requests
        while self.requests and self.requests[0] < now - self.window_seconds:
            self.requests.popleft()

        return max(0, self.max_requests - len(self.requests))

    def get_reset_time(self) -> int:
        """Get time (seconds) until window resets"""
        if not self.requests:
            return 0

        now = time.time()
        oldest_request = self.requests[0]
        reset_time = oldest_request + self.window_seconds

        return max(0, int(reset_time - now))


class RateLimitStatus:
    """Lightweight rate limit state for external backends."""

    def __init__(
        self, max_requests: int, window_seconds: int, remaining: int, reset_time: int
    ):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._remaining = remaining
        self._reset_time = reset_time

    def get_remaining(self) -> int:
        return max(0, int(self._remaining))

    def get_reset_time(self) -> int:
        return max(0, int(self._reset_time))


class RateLimiter:
    """Rate limiter with configurable limits per route pattern"""

    _STREAM_ROUTE_ACTIONS = {"start", "stop", "status", "logs"}

    def __init__(self, trusted_proxies: Iterable[str] | None = None):
        self.clients: Dict[str, RateLimitEntry] = {}
        self.lock = RLock()
        self.max_clients = 10000
        self._trusted_proxy_networks: List = []

        if trusted_proxies:
            for entry in trusted_proxies:
                try:
                    self._trusted_proxy_networks.append(ip_network(entry))
                except ValueError:
                    logger.warning("Invalid trusted proxy entry ignored: %s", entry)

        # Default limits (requests per minute)
        self.default_limit = 60
        self.default_window = 60

        # Endpoint-specific limits (requests per window).
        #
        # Token-mint, OAuth and signed-URL endpoints get tight per-key limits
        # because each successful call hands out a credential the attacker can
        # later use offline. Per-user-id keying (see _get_client_key) prevents
        # the trivial IP-rotation bypass — the limits below now bind to
        # (ip, user_id, endpoint).
        self.limits = {
            "/api/auth/login": (5, 60),
            "/api/auth/logout": (20, 60),
            "/api/auth/register": (3, 60),
            "/api/auth/refresh": (10, 60),  # token refresh — limit bot scrapers
            "/api/streams/start": (3, 120),
            "/api/streams/stop": (10, 60),
            "/api/streams/status": (60, 60),
            "/api/streams/logs": (15, 60),  # log read can be expensive on big files
            "/api/assets/upload": (30, 60),
            "/api/assets/upload-complete": (12, 60),
            "/api/assets/upload-token": (15, 60),  # token-mint
            "/api/assets/download-link": (15, 60),  # signed-URL mint
            "/api/youtube/oauth/start": (10, 60),
            "/api/youtube/oauth/callback": (10, 60),
            "/api/admin/alerts": (8, 60),
            "/api/admin/users": (12, 60),
            "/api/admin": (20, 60),
        }

    def _get_client_key(self, request: Request) -> str:
        """Generate unique key for client (IP + user_id + endpoint).

        Including ``user_id`` (when known) defeats the IP-rotation attack
        where a single authenticated user cycles through a NAT pool to
        multiply their per-IP quota. The user-id segment is taken from
        ``request.state.authenticated_user_id`` which is set by the auth
        dependency *before* the rate-limit check on authenticated routes;
        on unauthenticated routes we fall back to IP only and the segment
        becomes the literal "anon".
        """
        client_ip = self._get_client_ip(request)
        endpoint = self._normalize_endpoint_path(request.url.path)
        user_segment = getattr(request.state, "authenticated_user_id", None) or "anon"

        return f"{client_ip}:{user_segment}:{endpoint}"

    def _get_client_ip(self, request: Request) -> str:
        client_ip = request.client.host if request.client else "unknown"
        forwarded = request.headers.get("X-Forwarded-For")

        if forwarded and self._is_trusted_proxy(client_ip):
            forwarded_client = forwarded.split(",")[0].strip()
            if forwarded_client:
                return forwarded_client

        return client_ip

    def _is_trusted_proxy(self, client_ip: str) -> bool:
        if not self._trusted_proxy_networks:
            return False
        try:
            ip = ip_address(client_ip)
        except ValueError:
            return False
        return any(ip in network for network in self._trusted_proxy_networks)

    def _normalize_endpoint_path(self, path: str) -> str:
        """Normalize dynamic paths into stable route families when needed."""
        normalized_path = unquote(path or "").strip() or "/"
        parts = [part for part in normalized_path.split("/") if part]

        if (
            len(parts) == 4
            and parts[0] == "api"
            and parts[1] == "streams"
            and parts[3] in self._STREAM_ROUTE_ACTIONS
        ):
            return f"/api/streams/{parts[3]}"

        return normalized_path

    def _get_limits_for_endpoint(self, path: str) -> Tuple[int, int]:
        """Get rate limits for specific endpoint"""
        normalized_path = self._normalize_endpoint_path(path)

        # Check for exact match
        if normalized_path in self.limits:
            return self.limits[normalized_path]

        # Check for prefix match
        for pattern, limits in self.limits.items():
            if normalized_path.startswith(pattern):
                return limits

        # Return default limits
        return (self.default_limit, self.default_window)

    def check_rate_limit(self, request: Request) -> Tuple[bool, RateLimitEntry]:
        """
        Check if request is within rate limit.

        Returns:
            Tuple of (allowed, rate_limit_entry)
        """
        client_key = self._get_client_key(request)
        max_requests, window = self._get_limits_for_endpoint(request.url.path)

        with self.lock:
            # Get or create rate limit entry
            if client_key not in self.clients:
                self.clients[client_key] = RateLimitEntry(max_requests, window)

            entry = self.clients[client_key]

            # Update limits if they changed
            if entry.max_requests != max_requests or entry.window_seconds != window:
                entry.max_requests = max_requests
                entry.window_seconds = window

            # Check if allowed
            allowed = entry.is_allowed()

            if len(self.clients) > self.max_clients:
                oldest_key = next(iter(self.clients))
                if oldest_key != client_key:
                    self.clients.pop(oldest_key, None)

            return allowed, entry

    def cleanup_old_entries(self):
        """Remove old client entries to prevent memory leak"""
        with self.lock:
            now = time.time()
            to_remove = []

            for key, entry in self.clients.items():
                # Remove entries with no recent requests
                if (
                    not entry.requests
                    or entry.requests[-1] < now - entry.window_seconds * 2
                ):
                    to_remove.append(key)

            for key in to_remove:
                del self.clients[key]

            if to_remove:
                logger.debug(f"Cleaned up {len(to_remove)} old rate limit entries")


class RedisRateLimiter(RateLimiter):
    """Redis-backed rate limiter for multi-instance deployments."""

    def __init__(
        self,
        redis_url: str,
        trusted_proxies: Iterable[str] | None = None,
        prefix: str = "rate-limit",
    ):
        super().__init__(trusted_proxies=trusted_proxies)
        if redis is None:
            raise RuntimeError("redis library is not available")
        self.redis = redis.from_url(redis_url, encoding="utf-8", decode_responses=True)
        self.prefix = prefix

    async def check_rate_limit(self, request: Request) -> Tuple[bool, RateLimitStatus]:
        client_key = self._get_client_key(request)
        max_requests, window = self._get_limits_for_endpoint(request.url.path)
        key = f"{self.prefix}:{client_key}:{window}"

        try:
            async with self.redis.pipeline() as pipe:
                pipe.incr(key)
                pipe.ttl(key)
                count, ttl = await pipe.execute()

            if ttl is None or ttl < 0:
                await self.redis.expire(key, window)
                ttl = window

            remaining = max_requests - int(count)
            status = RateLimitStatus(max_requests, window, remaining, ttl)
            return remaining >= 0, status
        except Exception as exc:  # pragma: no cover - runtime fallback
            logger.warning(
                "Redis rate limiter failed; falling back to in-memory: %s", exc
            )
            allowed, entry = super().check_rate_limit(request)
            return allowed, RateLimitStatus(
                entry.max_requests,
                entry.window_seconds,
                entry.get_remaining(),
                entry.get_reset_time(),
            )


class RateLimitMiddleware(BaseHTTPMiddleware):
    """FastAPI middleware for rate limiting"""

    def __init__(self, app, rate_limiter: RateLimiter = None):
        super().__init__(app)
        self.rate_limiter = rate_limiter or RateLimiter()

        # Paths to exclude from rate limiting
        self.exclude_paths = [
            "/health",
            "/",
            "/docs",
            "/openapi.json",
            "/redoc",
        ]

    async def dispatch(self, request: Request, call_next):
        """Process request with rate limiting"""

        # Skip rate limiting for excluded paths
        if request.url.path in self.exclude_paths:
            return await call_next(request)

        # Check rate limit (supports async backends like Redis)
        result = self.rate_limiter.check_rate_limit(request)
        if inspect.isawaitable(result):
            allowed, entry = await result
        else:
            allowed, entry = result

        if not allowed:
            # Rate limit exceeded
            reset_time = entry.get_reset_time()
            client_host = self.rate_limiter._get_client_ip(request)

            logger.warning(
                f"Rate limit exceeded for {client_host} "
                f"on {request.url.path} - resets in {reset_time}s"
            )

            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": {
                        "error": "Rate limit exceeded",
                        "retry_after": reset_time,
                    }
                },
                headers={
                    "Retry-After": str(reset_time),
                    "X-RateLimit-Limit": str(entry.max_requests),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(time.time() + reset_time)),
                },
            )

        # Add rate limit headers to response
        response = await call_next(request)

        response.headers["X-RateLimit-Limit"] = str(entry.max_requests)
        response.headers["X-RateLimit-Remaining"] = str(entry.get_remaining())
        response.headers["X-RateLimit-Reset"] = str(
            int(time.time() + entry.get_reset_time())
        )

        return response


def _build_rate_limiter() -> RateLimiter:
    if settings.redis_url:
        try:
            rate_limiter = RedisRateLimiter(
                settings.redis_url,
                trusted_proxies=settings.trusted_proxies,
                prefix=settings.redis_rate_limit_prefix,
            )
            logger.info("Using Redis-backed rate limiter")
            return rate_limiter
        except Exception as exc:  # pragma: no cover - fallback on runtime errors
            logger.warning("Failed to initialize Redis rate limiter: %s", exc)
    return RateLimiter(trusted_proxies=settings.trusted_proxies)


# Global rate limiter instance
global_rate_limiter = _build_rate_limiter()
