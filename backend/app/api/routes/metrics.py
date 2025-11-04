from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Dict, Any
import psutil
import os

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.database import Stream
from uuid import UUID

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
    upload_dir = os.environ.get("UPLOAD_DIR", "/app/uploads")
    try:
        disk = psutil.disk_usage(upload_dir)
        disk_metrics = {
            "total_gb": round(disk.total / (1024**3), 2),
            "used_gb": round(disk.used / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2),
            "percent": disk.percent
        }
    except Exception:
        disk_metrics = None
    
    # Network metrics
    net_io = psutil.net_io_counters()
    
    return {
        "cpu": {
            "percent": cpu_percent,
            "count": cpu_count,
            "frequency_mhz": round(cpu_freq.current, 2) if cpu_freq else None
        },
        "memory": {
            "total_gb": round(memory.total / (1024**3), 2),
            "available_gb": round(memory.available / (1024**3), 2),
            "used_gb": round(memory.used / (1024**3), 2),
            "percent": memory.percent
        },
        "disk": disk_metrics,
        "network": {
            "bytes_sent": net_io.bytes_sent,
            "bytes_recv": net_io.bytes_recv,
            "packets_sent": net_io.packets_sent,
            "packets_recv": net_io.packets_recv
        }
    }


async def get_stream_metrics(db: AsyncSession, user_id: str) -> Dict[str, Any]:
    """Get stream-related metrics for the current user."""
    try:
        user_uuid = UUID(user_id)
    except (ValueError, TypeError):
        user_uuid = user_id
    
    # Count total streams
    result = await db.execute(
        select(func.count(Stream.id)).where(Stream.user_id == user_uuid)
    )
    total_streams = result.scalar()
    
    # Count active streams
    result = await db.execute(
        select(func.count(Stream.id)).where(
            Stream.user_id == user_uuid,
            Stream.status == "running"
        )
    )
    active_streams = result.scalar()
    
    # Count inactive streams (represented as "stopped" in the database)
    result = await db.execute(
        select(func.count(Stream.id)).where(
            Stream.user_id == user_uuid,
            Stream.status == "stopped"
        )
    )
    idle_streams = result.scalar()
    
    # Count error streams
    result = await db.execute(
        select(func.count(Stream.id)).where(
            Stream.user_id == user_uuid,
            Stream.status == "error"
        )
    )
    error_streams = result.scalar()
    
    return {
        "total_streams": total_streams,
        "active_streams": active_streams,
        "idle_streams": idle_streams,
        "error_streams": error_streams
    }


def estimate_stream_capacity(cpu_percent: float, memory_percent: float, active_streams: int) -> Dict[str, Any]:
    """Estimate how many additional streams can be supported based on current resource usage."""
    
    # Conservative estimates:
    # - Each stream uses ~2-5% CPU (with -c copy, no transcoding)
    # - Each stream uses ~50-100MB RAM
    # - Keep 20% CPU and 20% memory as buffer
    
    avg_cpu_per_stream = 3.5  # percent
    avg_memory_per_stream_gb = 0.075  # 75MB
    
    cpu_available = 80 - cpu_percent  # Keep 20% buffer
    memory_available = 80 - memory_percent  # Keep 20% buffer
    
    # Estimate additional capacity based on CPU
    cpu_capacity = max(0, int(cpu_available / avg_cpu_per_stream))
    
    # Estimate additional capacity based on memory
    memory = psutil.virtual_memory()
    memory_available_gb = (memory.total * (memory_available / 100)) / (1024**3)
    memory_capacity = max(0, int(memory_available_gb / avg_memory_per_stream_gb))
    
    # Take the minimum of both
    estimated_additional_capacity = min(cpu_capacity, memory_capacity)
    
    return {
        "active_streams": active_streams,
        "estimated_additional_capacity": estimated_additional_capacity,
        "estimated_total_capacity": active_streams + estimated_additional_capacity,
        "cpu_limited": cpu_capacity < memory_capacity,
        "memory_limited": memory_capacity < cpu_capacity
    }


@router.get("/")
async def get_metrics(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get comprehensive system and stream metrics.
    
    Returns:
    - System metrics (CPU, memory, disk, network)
    - Stream metrics (total, active, idle, error counts)
    - Capacity estimation (how many additional streams can be supported)
    """
    user_id = current_user["sub"]
    
    # Get system metrics
    system_metrics = get_system_metrics()
    
    # Get stream metrics
    stream_metrics = await get_stream_metrics(db, user_id)
    
    # Estimate capacity
    capacity = estimate_stream_capacity(
        cpu_percent=system_metrics["cpu"]["percent"],
        memory_percent=system_metrics["memory"]["percent"],
        active_streams=stream_metrics["active_streams"]
    )
    
    return {
        "system": system_metrics,
        "streams": stream_metrics,
        "capacity": capacity
    }
