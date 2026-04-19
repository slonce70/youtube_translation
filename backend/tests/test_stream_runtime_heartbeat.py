from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.core.config import settings
from app.core.stream_runtime_heartbeat import (
    clear_runtime_heartbeat,
    get_runtime_heartbeat_path,
    read_runtime_heartbeat,
    stale_runtime_heartbeat_reason,
    runtime_heartbeat_is_stale,
    write_runtime_heartbeat,
)


def test_runtime_heartbeat_round_trip_and_clear(tmp_path, monkeypatch) -> None:
    stream_id = uuid4()
    monkeypatch.setattr(settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(settings, "stream_runtime_heartbeat_ttl_seconds", 30)

    payload = write_runtime_heartbeat(
        stream_id,
        runner_pid=111,
        ffmpeg_pid=222,
        launcher="cli",
        metadata={"owner": "runner"},
    )

    heartbeat_path = get_runtime_heartbeat_path(stream_id)
    stored = read_runtime_heartbeat(stream_id)

    assert heartbeat_path.exists()
    assert stored is not None
    assert stored["stream_id"] == str(stream_id)
    assert stored["node_id"] == settings.stream_runtime_node_id
    assert stored["lease_owner_id"] == settings.stream_runtime_node_id
    assert stored["runner_pid"] == 111
    assert stored["ffmpeg_pid"] == 222
    assert stored["metadata"] == {"owner": "runner"}
    assert runtime_heartbeat_is_stale(payload) is False

    clear_runtime_heartbeat(stream_id)
    assert not heartbeat_path.exists()


def test_runtime_heartbeat_detects_staleness_from_expiry(tmp_path, monkeypatch) -> None:
    stream_id = uuid4()
    monkeypatch.setattr(settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(settings, "stream_runtime_heartbeat_ttl_seconds", 10)

    now = datetime.now(timezone.utc)
    payload = write_runtime_heartbeat(
        stream_id,
        runner_pid=333,
        now=now - timedelta(seconds=20),
        ttl_seconds=5,
    )

    assert runtime_heartbeat_is_stale(payload, now=now) is True


def test_stale_runtime_heartbeat_reason_reports_runtime_and_runner_pid(
    tmp_path, monkeypatch
) -> None:
    stream_id = uuid4()
    monkeypatch.setattr(settings, "stream_dir", str(tmp_path))
    monkeypatch.setattr(settings, "stream_runtime_heartbeat_ttl_seconds", 10)

    now = datetime.now(timezone.utc)
    payload = write_runtime_heartbeat(
        stream_id,
        runner_pid=444,
        runtime_mode="systemd",
        now=now - timedelta(seconds=20),
        ttl_seconds=5,
    )

    reason = stale_runtime_heartbeat_reason(payload)

    assert reason is not None
    assert "systemd runner heartbeat expired" in reason
    assert "runner_pid=444" in reason
