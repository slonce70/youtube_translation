import os
from typing import Any, Dict, Optional
from uuid import UUID

import psutil  # type: ignore[import-untyped]
from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import metrics_registry
from app.core.mediamtx import fetch_mediamtx_summary
from app.api.deps import require_admin, require_metrics_access
from app.core.config import settings
from app.models.database import Stream

router = APIRouter(prefix="/metrics", tags=["metrics"])


def get_system_metrics() -> Dict[str, Any]:
    """Get system-wide metrics using psutil."""

    # CPU metrics
    cpu_percent = psutil.cpu_percent(interval=0.1)
    cpu_count = psutil.cpu_count()
    cpu_freq = psutil.cpu_freq()

    # Memory metrics
    memory = psutil.virtual_memory()

    # Disk metrics for upload directory
    upload_dir = settings.upload_dir or os.environ.get("UPLOAD_DIR", "/app/uploads")
    try:
        disk = psutil.disk_usage(upload_dir)
        warning_threshold = max(0, min(100, settings.disk_warning_percent))
        critical_threshold = max(0, min(100, settings.disk_critical_percent))
        if critical_threshold < warning_threshold:
            critical_threshold = warning_threshold
        status = "ok"
        if disk.percent >= critical_threshold:
            status = "critical"
        elif disk.percent >= warning_threshold:
            status = "warning"
        disk_metrics = {
            "total_gb": round(disk.total / (1024**3), 2),
            "used_gb": round(disk.used / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2),
            "percent": disk.percent,
            "status": status,
            "warning_threshold": warning_threshold,
            "critical_threshold": critical_threshold,
        }
    except Exception:
        disk_metrics = None

    # Network metrics
    net_io = psutil.net_io_counters()

    return {
        "cpu": {
            "percent": cpu_percent,
            "count": cpu_count,
            "frequency_mhz": round(cpu_freq.current, 2) if cpu_freq else None,
        },
        "memory": {
            "total_gb": round(memory.total / (1024**3), 2),
            "available_gb": round(memory.available / (1024**3), 2),
            "used_gb": round(memory.used / (1024**3), 2),
            "percent": memory.percent,
        },
        "disk": disk_metrics,
        "network": {
            "bytes_sent": net_io.bytes_sent,
            "bytes_recv": net_io.bytes_recv,
            "packets_sent": net_io.packets_sent,
            "packets_recv": net_io.packets_recv,
        },
    }


async def get_stream_metrics(
    db: AsyncSession, user_id: Optional[str] = None
) -> Dict[str, Any]:
    """Get stream-related metrics for a user or globally when user_id is omitted."""
    stream_filters = []
    if user_id is not None:
        try:
            user_key: UUID | str = UUID(user_id)
        except (ValueError, TypeError):
            user_key = user_id
        stream_filters.append(Stream.user_id == user_key)

    # Count total streams
    result = await db.execute(select(func.count(Stream.id)).where(*stream_filters))
    total_streams = result.scalar()

    # Count active streams
    result = await db.execute(
        select(func.count(Stream.id)).where(*stream_filters, Stream.status == "running")
    )
    active_streams = result.scalar()

    # Count inactive streams (represented as "stopped" in the database)
    result = await db.execute(
        select(func.count(Stream.id)).where(*stream_filters, Stream.status == "stopped")
    )
    idle_streams = result.scalar()

    # Count error streams
    result = await db.execute(
        select(func.count(Stream.id)).where(*stream_filters, Stream.status == "error")
    )
    error_streams = result.scalar()

    restart_enabled = False
    scheduled_restart_streams = 0
    streams_with_retry_history = 0
    total_restart_attempts = 0
    next_restart_at = None

    return {
        "total_streams": total_streams,
        "active_streams": active_streams,
        "idle_streams": idle_streams,
        "error_streams": error_streams,
        "restart_orchestration": {
            "auto_restart_enabled": restart_enabled,
            "scheduled_restart_streams": scheduled_restart_streams,
            "streams_with_retry_history": streams_with_retry_history,
            "total_restart_attempts": total_restart_attempts,
            "max_attempts": 0,
            "next_restart_at": next_restart_at,
        },
    }


def estimate_stream_capacity(
    cpu_percent: float, memory_percent: float, active_streams: int
) -> Dict[str, Any]:
    """Estimate how many additional streams can be supported based on current resource usage."""

    # Conservative estimates:
    # - Each stream uses ~2-5% CPU (with -c copy, no transcoding)
    # - Each stream uses ~50-100MB RAM
    # - Keep 20% CPU and 20% memory as buffer

    avg_cpu_per_stream = 3.5  # percent
    avg_memory_per_stream_gb = 0.075  # 75MB
    reserved_cpu_percent = 20
    reserved_memory_percent = 20

    cpu_available = max(0.0, 100 - reserved_cpu_percent - cpu_percent)
    memory_available = max(0.0, 100 - reserved_memory_percent - memory_percent)

    # Estimate additional capacity based on CPU
    cpu_capacity = max(0, int(cpu_available / avg_cpu_per_stream))

    # Estimate additional capacity based on memory
    memory = psutil.virtual_memory()
    memory_available_gb = (memory.total * (memory_available / 100)) / (1024**3)
    memory_capacity = max(0, int(memory_available_gb / avg_memory_per_stream_gb))

    # Take the minimum of both
    estimated_additional_capacity = min(cpu_capacity, memory_capacity)

    return {
        "mode": "heuristic",
        "recommended_for_production_decisions": False,
        "summary": (
            "Heuristic estimate based on copy-oriented stream assumptions. "
            "Use measured workload profiles for production capacity planning."
        ),
        "active_streams": active_streams,
        "estimated_additional_capacity": estimated_additional_capacity,
        "estimated_total_capacity": active_streams + estimated_additional_capacity,
        "cpu_limited": cpu_capacity < memory_capacity,
        "memory_limited": memory_capacity < cpu_capacity,
        "assumptions": {
            "avg_cpu_percent_per_stream": avg_cpu_per_stream,
            "avg_memory_gb_per_stream": avg_memory_per_stream_gb,
            "reserved_cpu_percent": reserved_cpu_percent,
            "reserved_memory_percent": reserved_memory_percent,
        },
    }


@router.get("/")
async def get_metrics(
    admin_deps: tuple = Depends(require_admin),
):
    """
    Get comprehensive system and stream metrics.

    Returns:
    - System metrics (CPU, memory, disk, network)
    - Stream metrics (total, active, idle, error counts)
    - Capacity estimation (how many additional streams can be supported)
    """
    db, user_id = admin_deps

    # Get system metrics
    system_metrics = get_system_metrics()

    # Get stream metrics
    stream_metrics = await get_stream_metrics(db)

    # Estimate capacity
    capacity = estimate_stream_capacity(
        cpu_percent=system_metrics["cpu"]["percent"],
        memory_percent=system_metrics["memory"]["percent"],
        active_streams=stream_metrics["active_streams"],
    )

    return {
        "system": system_metrics,
        "streams": stream_metrics,
        "capacity": capacity,
        "media_plane": {
            "mediamtx": await fetch_mediamtx_summary(),
        },
    }


@router.get("/prometheus", response_class=PlainTextResponse)
async def export_prometheus_metrics(
    _: dict = Depends(require_metrics_access),
) -> PlainTextResponse:
    """Expose metrics in Prometheus exposition format."""
    payload = metrics_registry.export_prometheus()
    return PlainTextResponse(payload, media_type="text/plain; version=0.0.4")
