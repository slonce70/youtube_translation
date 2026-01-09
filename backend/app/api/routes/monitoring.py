"""
Monitoring endpoints for metrics and health checks
"""

from fastapi import APIRouter, Depends, Response
from app.api.deps import require_metrics_access
from app.core.metrics import metrics_registry, get_metrics_summary

router = APIRouter()


@router.get("/metrics")
async def get_metrics(_: dict = Depends(require_metrics_access)):
    """
    Get metrics in JSON format.
    For human-readable view.
    """
    return get_metrics_summary()


@router.get("/metrics/prometheus")
async def get_prometheus_metrics(_: dict = Depends(require_metrics_access)):
    """
    Get metrics in Prometheus format.
    Can be scraped by Prometheus server.
    """
    metrics_text = metrics_registry.export_prometheus()
    return Response(content=metrics_text, media_type="text/plain")
