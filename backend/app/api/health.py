"""Health and readiness endpoints.

Two distinct probes:

* ``/healthz`` (liveness) — returns 200 as long as the process is up and the
  event loop is responsive. Used by the container HEALTHCHECK and by k8s/
  systemd liveness probes.
* ``/readyz`` (readiness) — verifies external dependencies (DB, Redis if
  configured, upload directory writable). Returns 503 with a JSON breakdown
  when any check fails so load balancers stop sending traffic to a node that
  cannot serve real requests.

``/health`` is preserved as an alias of ``/healthz`` for backwards
compatibility with the existing Compose / Caddy probes.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.core.database import async_session_maker

logger = logging.getLogger(__name__)

router = APIRouter()

_CHECK_TIMEOUT_SECONDS = 0.5


async def _check_database() -> Dict[str, Any]:
    started = time.perf_counter()
    try:
        async with asyncio.timeout(_CHECK_TIMEOUT_SECONDS):
            async with async_session_maker() as session:
                await session.execute(text("SELECT 1"))
        return {
            "ok": True,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except (asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": type(exc).__name__,
            "detail": str(exc)[:200],
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }


async def _check_redis() -> Dict[str, Any]:
    if not settings.redis_url:
        return {"ok": True, "skipped": True, "reason": "redis_url not configured"}

    started = time.perf_counter()
    try:
        import redis.asyncio as redis  # type: ignore
    except ImportError:
        return {"ok": False, "error": "redis library not installed"}

    client = None
    try:
        client = redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=_CHECK_TIMEOUT_SECONDS,
            socket_timeout=_CHECK_TIMEOUT_SECONDS,
        )
        async with asyncio.timeout(_CHECK_TIMEOUT_SECONDS):
            pong = await client.ping()
        return {
            "ok": bool(pong),
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except (asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": type(exc).__name__,
            "detail": str(exc)[:200],
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    finally:
        if client is not None:
            try:
                await client.aclose()
            except Exception:  # noqa: BLE001
                pass


def _check_upload_dir() -> Dict[str, Any]:
    upload_dir = settings.upload_dir
    if not os.path.isdir(upload_dir):
        return {"ok": False, "error": "missing", "path": upload_dir}
    if not os.access(upload_dir, os.W_OK):
        return {"ok": False, "error": "not_writable", "path": upload_dir}
    return {"ok": True, "path": upload_dir}


@router.get("/healthz", include_in_schema=False)
async def healthz() -> Dict[str, str]:
    """Liveness probe — the process is up and the event loop is responsive."""
    return {"status": "alive"}


@router.get("/health", include_in_schema=False)
async def health_alias() -> Dict[str, str]:
    """Backwards-compatible alias for ``/healthz``."""
    return {"status": "healthy"}


@router.get("/readyz", include_in_schema=False)
async def readyz() -> ORJSONResponse:
    """Readiness probe — verifies that external dependencies are reachable."""
    db_check, redis_check = await asyncio.gather(
        _check_database(), _check_redis(), return_exceptions=False
    )
    upload_check = _check_upload_dir()

    checks: Dict[str, Any] = {
        "db": db_check,
        "redis": redis_check,
        "upload_dir": upload_check,
    }

    all_ok = all(check.get("ok", False) for check in checks.values())
    payload = {"status": "ready" if all_ok else "degraded", "checks": checks}
    status_code = 200 if all_ok else 503

    if not all_ok:
        failed = [name for name, check in checks.items() if not check.get("ok", False)]
        logger.warning("readiness check failed: %s", ",".join(failed))

    return ORJSONResponse(payload, status_code=status_code)
