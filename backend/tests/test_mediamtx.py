import httpx
import pytest

from app.core.config import settings
from app.core.mediamtx import fetch_mediamtx_summary, parse_mediamtx_metrics


def test_parse_mediamtx_metrics_aggregates_paths_and_connections() -> None:
    payload = """
# HELP paths paths
paths{name="alpha",state="ready"} 1
paths{name="beta",state="notReady"} 1
paths_bytes_received{name="alpha",state="ready"} 120
paths_bytes_sent{name="alpha",state="ready"} 240
paths_readers{name="alpha",state="ready"} 3
rtmp_conns{id="1",path="alpha",remoteAddr="127.0.0.1",state="publish"} 1
rtmps_conns{id="2",path="beta",remoteAddr="127.0.0.1",state="read"} 1
hls_muxers{name="alpha"} 1
"""

    summary = parse_mediamtx_metrics(payload)

    assert summary["path_count"] == 2
    assert summary["ready_path_count"] == 1
    assert summary["path_states"] == {"ready": 1, "notReady": 1}
    assert summary["bytes_received_total"] == 120
    assert summary["bytes_sent_total"] == 240
    assert summary["readers_total"] == 3
    assert summary["rtmp_connection_count"] == 1
    assert summary["rtmps_connection_count"] == 1
    assert summary["hls_muxer_count"] == 1


@pytest.mark.asyncio
async def test_fetch_mediamtx_summary_returns_reachable_summary(monkeypatch) -> None:
    monkeypatch.setattr(settings, "mediamtx_enabled", True)
    monkeypatch.setattr(settings, "mediamtx_metrics_url", "http://mediamtx.test:9998/metrics")
    monkeypatch.setattr(settings, "mediamtx_control_api_url", "http://mediamtx.test:9997")
    monkeypatch.setattr(settings, "mediamtx_rtmp_publish_url", "rtmp://mediamtx.test:1935")

    metrics_payload = 'paths{name="alpha",state="ready"} 1\n'
    control_payload = {
        "itemCount": 1,
        "pageCount": 1,
        "items": [
            {
                "name": "alpha",
                "confName": "all_others",
                "ready": True,
                "available": True,
                "online": True,
                "source": {"type": "rtmpConn"},
                "tracks": ["H264", "MPEG-4 Audio"],
                "readers": [],
                "bytesReceived": 123,
                "bytesSent": 45,
            }
        ],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == "http://mediamtx.test:9998/metrics":
            return httpx.Response(200, text=metrics_payload)
        if str(request.url) == "http://mediamtx.test:9997/v3/paths/list":
            return httpx.Response(200, json=control_payload)
        raise AssertionError(f"Unexpected request URL: {request.url}")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        summary = await fetch_mediamtx_summary(client=client)

    assert summary is not None
    assert summary["enabled"] is True
    assert summary["reachable"] is True
    assert summary["path_count"] == 1
    assert summary["control_api_reachable"] is True
    assert summary["active_path_names"] == ["alpha"]
    assert summary["active_paths"][0]["source_type"] == "rtmpConn"
    assert summary["control_api_url"] == "http://mediamtx.test:9997"
    assert summary["rtmp_publish_url"] == "rtmp://mediamtx.test:1935"


@pytest.mark.asyncio
async def test_fetch_mediamtx_summary_handles_unreachable_control_api(monkeypatch) -> None:
    monkeypatch.setattr(settings, "mediamtx_enabled", True)
    monkeypatch.setattr(settings, "mediamtx_metrics_url", "http://mediamtx.test:9998/metrics")
    monkeypatch.setattr(settings, "mediamtx_control_api_url", "http://mediamtx.test:9997")

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == "http://mediamtx.test:9998/metrics":
            return httpx.Response(200, text='paths{name="alpha",state="ready"} 1\n')
        if str(request.url) == "http://mediamtx.test:9997/v3/paths/list":
            return httpx.Response(503, text="unavailable")
        raise AssertionError(f"Unexpected request URL: {request.url}")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        summary = await fetch_mediamtx_summary(client=client)

    assert summary is not None
    assert summary["enabled"] is True
    assert summary["reachable"] is True
    assert summary["control_api_reachable"] is False
    assert "503" in summary["control_api_error"]
    assert summary["active_paths"] == []


@pytest.mark.asyncio
async def test_fetch_mediamtx_summary_handles_unreachable_metrics_endpoint(monkeypatch) -> None:
    monkeypatch.setattr(settings, "mediamtx_enabled", True)
    monkeypatch.setattr(settings, "mediamtx_metrics_url", "http://mediamtx.test:9998/metrics")

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="unavailable")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        summary = await fetch_mediamtx_summary(client=client)

    assert summary is not None
    assert summary["enabled"] is True
    assert summary["reachable"] is False
    assert "503" in summary["error"]
