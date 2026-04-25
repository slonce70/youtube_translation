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
    """Run ``SELECT 1`` against the application DB pool with a short timeout.

    The public response intentionally omits the exception detail (str(exc))
    so that callers cannot harvest the DB DSN, hostname, or username from a
    transient outage. Full error context is emitted to the structured log
    instead.
    """
    started = time.perf_counter()
    try:
        async with asyncio.timeout(_CHECK_TIMEOUT_SECONDS):
            async with async_session_maker() as session:
                await session.execute(text("SELECT 1"))
        return {
            "ok": True,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "readyz: database check failed: %s: %s",
            type(exc).__name__,
            str(exc)[:500],
        )
        return {
            "ok": False,
            "error": type(exc).__name__,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }


async def _check_redis() -> Dict[str, Any]:
    if not settings.redis_url:
        return {"ok": True, "skipped": True}

    started = time.perf_counter()
    try:
        import redis.asyncio as redis  # type: ignore
    except ImportError:
        logger.warning("readyz: redis library not installed")
        return {"ok": False, "error": "ImportError"}

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
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "readyz: redis check failed: %s: %s",
            type(exc).__name__,
            str(exc)[:500],
        )
        return {
            "ok": False,
            "error": type(exc).__name__,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    finally:
        if client is not None:
            try:
                await client.aclose()
            except Exception:  # noqa: BLE001
                pass


def _check_upload_dir_sync() -> Dict[str, Any]:
    upload_dir = settings.upload_dir
    if not os.path.isdir(upload_dir):
        logger.warning("readyz: upload_dir missing: %s", upload_dir)
        return {"ok": False, "error": "missing"}
    if not os.access(upload_dir, os.W_OK):
        logger.warning("readyz: upload_dir not writable: %s", upload_dir)
        return {"ok": False, "error": "not_writable"}
    return {"ok": True}


async def _check_upload_dir() -> Dict[str, Any]:
    """Run blocking filesystem checks in a thread to keep the loop responsive.

    A stalled bind-mount (NFS/EFS) could otherwise hang the readiness probe
    indefinitely, blocking every other coroutine on the loop.
    """
    try:
        async with asyncio.timeout(_CHECK_TIMEOUT_SECONDS):
            return await asyncio.to_thread(_check_upload_dir_sync)
    except asyncio.TimeoutError:
        logger.warning("readyz: upload_dir check timed out")
        return {"ok": False, "error": "TimeoutError"}


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
    db_check, redis_check, upload_check = await asyncio.gather(
        _check_database(),
        _check_redis(),
        _check_upload_dir(),
        return_exceptions=False,
    )

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
