from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.core.config import settings
from app.middleware import rate_limiter as rate_limiter_module
from app.middleware.rate_limiter import (
    RateLimitMiddleware,
    RateLimiter,
    RedisRateLimiter,
    _build_rate_limiter,
)


def _make_request(
    path: str,
    client_host: str = "198.51.100.10",
    forwarded_for: str | None = None,
) -> Request:
    headers = []
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))

    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": headers,
        "client": (client_host, 12345),
        "server": ("testserver", 80),
        "scheme": "http",
        "query_string": b"",
    }
    return Request(scope)


def _build_app_with_limiter(limiter: RateLimiter) -> FastAPI:
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, rate_limiter=limiter)

    @app.post("/api/auth/login")
    async def login():
        return {"ok": True}

    return app


def test_sensitive_route_limits():
    limiter = RateLimiter()

    assert limiter._get_limits_for_endpoint("/api/streams/start") == (3, 120)
    assert limiter._get_limits_for_endpoint("/api/assets/upload-complete") == (12, 60)
    assert limiter._get_limits_for_endpoint("/api/admin/users/summary") == (12, 60)
    assert limiter._get_limits_for_endpoint("/api/admin/alerts") == (8, 60)
    # Fallback to general admin limit when no specific match
    assert limiter._get_limits_for_endpoint("/api/admin/dashboard") == (20, 60)


def test_client_key_uses_forwarded_for_for_trusted_proxy():
    limiter = RateLimiter(trusted_proxies=["10.0.0.0/8"])
    request = _make_request(
        "/api/auth/login",
        client_host="10.1.2.3",
        forwarded_for="198.51.100.77, 10.1.2.3",
    )

    assert limiter._get_client_key(request) == "198.51.100.77:/api/auth/login"


def test_client_ip_uses_forwarded_for_for_trusted_proxy():
    limiter = RateLimiter(trusted_proxies=["10.0.0.0/8"])
    request = _make_request(
        "/api/auth/login",
        client_host="10.1.2.3",
        forwarded_for="198.51.100.77, 10.1.2.3",
    )

    assert limiter._get_client_ip(request) == "198.51.100.77"


def test_client_key_ignores_forwarded_for_for_untrusted_proxy():
    limiter = RateLimiter(trusted_proxies=["10.0.0.0/8"])
    request = _make_request(
        "/api/auth/login",
        client_host="203.0.113.9",
        forwarded_for="198.51.100.77, 10.1.2.3",
    )

    assert limiter._get_client_key(request) == "203.0.113.9:/api/auth/login"


def test_rate_limit_middleware_returns_429_with_headers():
    limiter = RateLimiter()
    app = _build_app_with_limiter(limiter)
    client = TestClient(app)

    for _ in range(5):
        response = client.post("/api/auth/login")
        assert response.status_code == 200

    limited = client.post("/api/auth/login")

    assert limited.status_code == 429
    assert limited.json()["detail"]["error"] == "Rate limit exceeded"
    assert "retry_after" in limited.json()["detail"]
    assert limited.headers["Retry-After"].isdigit()
    assert limited.headers["X-RateLimit-Limit"] == "5"
    assert limited.headers["X-RateLimit-Remaining"] == "0"
    assert limited.headers["X-RateLimit-Reset"].isdigit()


def test_build_rate_limiter_uses_redis_when_configured(monkeypatch):
    class FakeRedisModule:
        @staticmethod
        def from_url(url: str, encoding: str, decode_responses: bool):
            assert url == "redis://redis:6379/0"
            assert encoding == "utf-8"
            assert decode_responses is True
            return SimpleNamespace()

    monkeypatch.setattr(settings, "redis_url", "redis://redis:6379/0")
    monkeypatch.setattr(settings, "trusted_proxy_ips", "10.0.0.0/8")
    monkeypatch.setattr(rate_limiter_module, "redis", FakeRedisModule())

    limiter = _build_rate_limiter()

    assert isinstance(limiter, RedisRateLimiter)


def test_build_rate_limiter_falls_back_when_redis_init_fails(monkeypatch):
    class BrokenRedisModule:
        @staticmethod
        def from_url(url: str, encoding: str, decode_responses: bool):
            raise RuntimeError("boom")

    monkeypatch.setattr(settings, "redis_url", "redis://redis:6379/0")
    monkeypatch.setattr(settings, "trusted_proxy_ips", "")
    monkeypatch.setattr(rate_limiter_module, "redis", BrokenRedisModule())

    limiter = _build_rate_limiter()

    assert isinstance(limiter, RateLimiter)
    assert not isinstance(limiter, RedisRateLimiter)
