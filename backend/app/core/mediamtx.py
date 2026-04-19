"""Helpers for optional MediaMTX integration.

The current product still uses FFmpeg as the playout/publish engine. MediaMTX
is treated as an optional media-plane relay that can expose RTMP ingress plus
observability endpoints for future scale-up.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, Optional

import httpx

from app.core.config import settings

_METRIC_LINE_RE = re.compile(
    r"^(?P<name>[a-zA-Z_:][a-zA-Z0-9_:]*)(?P<labels>\{.*\})?\s+(?P<value>[-+]?[0-9]*\.?[0-9]+)$"
)
_STATE_RE = re.compile(r'state="([^"]+)"')


def mediamtx_configured() -> bool:
    return bool(settings.mediamtx_enabled and settings.mediamtx_metrics_url)


def _control_api_paths_url() -> Optional[str]:
    if not settings.mediamtx_control_api_url:
        return None
    return f"{str(settings.mediamtx_control_api_url).rstrip('/')}/v3/paths/list"


def _summarize_control_api_items(payload: Dict[str, Any]) -> Dict[str, Any]:
    items = payload.get("items") or []
    active_paths = []

    for item in items:
        if not isinstance(item, dict):
            continue

        active_paths.append(
            {
                "name": item.get("name"),
                "conf_name": item.get("confName"),
                "ready": bool(item.get("ready")),
                "available": bool(item.get("available")),
                "online": bool(item.get("online")),
                "source_type": (item.get("source") or {}).get("type"),
                "tracks": item.get("tracks") or [],
                "reader_count": len(item.get("readers") or []),
                "bytes_received": item.get(
                    "bytesReceived", item.get("inboundBytes", 0)
                ),
                "bytes_sent": item.get("bytesSent", item.get("outboundBytes", 0)),
            }
        )

    return {
        "active_paths": active_paths,
        "active_path_names": [
            path["name"] for path in active_paths if path.get("name")
        ],
        "control_api_path_count": len(active_paths),
    }


def parse_mediamtx_metrics(payload: str) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "path_count": 0,
        "ready_path_count": 0,
        "path_states": {},
        "bytes_received_total": 0,
        "bytes_sent_total": 0,
        "readers_total": 0,
        "rtmp_connection_count": 0,
        "rtmps_connection_count": 0,
        "hls_muxer_count": 0,
    }

    for raw_line in (payload or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        match = _METRIC_LINE_RE.match(line)
        if not match:
            continue

        name = match.group("name")
        labels = match.group("labels") or ""
        value = float(match.group("value"))

        if name == "paths":
            summary["path_count"] += int(value)
            state_match = _STATE_RE.search(labels)
            state = state_match.group(1) if state_match else "unknown"
            summary["path_states"][state] = summary["path_states"].get(state, 0) + int(
                value
            )
            if state == "ready":
                summary["ready_path_count"] += int(value)
        elif name == "paths_bytes_received":
            summary["bytes_received_total"] += int(value)
        elif name == "paths_bytes_sent":
            summary["bytes_sent_total"] += int(value)
        elif name == "paths_readers":
            summary["readers_total"] += int(value)
        elif name == "rtmp_conns":
            summary["rtmp_connection_count"] += int(value)
        elif name == "rtmps_conns":
            summary["rtmps_connection_count"] += int(value)
        elif name == "hls_muxers":
            summary["hls_muxer_count"] += int(value)

    return summary


async def fetch_mediamtx_summary(
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> Optional[Dict[str, Any]]:
    if not mediamtx_configured():
        return None

    metrics_url = str(settings.mediamtx_metrics_url)
    control_api_paths_url = _control_api_paths_url()
    own_client = client is None
    async_client = client or httpx.AsyncClient(timeout=2.0)

    try:
        metrics_task = async_client.get(metrics_url)
        if control_api_paths_url:
            metrics_response, control_response = await asyncio.gather(
                metrics_task,
                async_client.get(control_api_paths_url),
                return_exceptions=True,
            )
        else:
            metrics_response = await metrics_task
            control_response = None

        if isinstance(metrics_response, BaseException):
            raise metrics_response
        metrics_response.raise_for_status()

        summary = parse_mediamtx_metrics(metrics_response.text)

        if isinstance(control_response, httpx.Response):
            try:
                control_response.raise_for_status()
                summary.update(_summarize_control_api_items(control_response.json()))
                summary["control_api_reachable"] = True
            except Exception as control_exc:  # pylint: disable=broad-except
                summary.update(
                    {
                        "active_paths": [],
                        "active_path_names": [],
                        "control_api_path_count": 0,
                        "control_api_reachable": False,
                        "control_api_error": str(control_exc),
                    }
                )
        elif isinstance(control_response, BaseException):
            summary.update(
                {
                    "active_paths": [],
                    "active_path_names": [],
                    "control_api_path_count": 0,
                    "control_api_reachable": False,
                    "control_api_error": str(control_response),
                }
            )
        else:
            summary.update(
                {
                    "active_paths": [],
                    "active_path_names": [],
                    "control_api_path_count": 0,
                    "control_api_reachable": bool(control_api_paths_url),
                }
            )

        summary.update(
            {
                "enabled": True,
                "reachable": True,
                "metrics_url": metrics_url,
                "control_api_url": settings.mediamtx_control_api_url,
                "control_api_paths_url": control_api_paths_url,
                "rtmp_publish_url": settings.mediamtx_rtmp_publish_url,
            }
        )
        return summary
    except Exception as exc:  # pylint: disable=broad-except
        return {
            "enabled": True,
            "reachable": False,
            "metrics_url": metrics_url,
            "control_api_url": settings.mediamtx_control_api_url,
            "control_api_paths_url": control_api_paths_url,
            "rtmp_publish_url": settings.mediamtx_rtmp_publish_url,
            "error": str(exc),
        }
    finally:
        if own_client:
            await async_client.aclose()
