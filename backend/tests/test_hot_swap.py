"""Tests for hot swap runtime queue management."""

from __future__ import annotations

from collections import deque
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.streaming.hot_swap import SlotQueue, StreamHotSwapManager
from app.streaming.playlist_builder import PlaylistFileSet


@pytest.mark.asyncio
async def test_slot_queue_assigns_first_enqueue(tmp_path, monkeypatch):
    """Enqueued assets should immediately occupy the first empty slot."""

    slot_paths = [tmp_path / "slot0.media", tmp_path / "slot1.media"]
    assigned_calls: list[tuple[Path, str | None]] = []

    def fake_assign(slot_path: Path, asset):
        assigned_calls.append((slot_path, asset.get("asset_id") if asset else None))

    monkeypatch.setattr(
        "app.streaming.playlist_builder.PlaylistBuilder._assign_slot_file",
        fake_assign,
    )

    queue = SlotQueue(
        name="video",
        slot_paths=slot_paths,
        loop_enabled=False,
        shuffle_enabled=False,
    )

    asset = {"asset_id": "asset-1", "path": str(tmp_path / "asset1.mp4")}
    await queue.enqueue(asset)

    assert queue.assigned[0] is not None
    assert queue.assigned[0]["asset_id"] == "asset-1"
    assert assigned_calls and assigned_calls[0][0] == slot_paths[0]


@pytest.mark.asyncio
async def test_slot_queue_advance_recycles_when_loop_enabled(tmp_path, monkeypatch):
    """Advancing a looping slot should recycle the previous asset to the queue."""

    slot_paths = [tmp_path / "slot0.media", tmp_path / "slot1.media"]
    monkeypatch.setattr(
        "app.streaming.playlist_builder.PlaylistBuilder._assign_slot_file",
        lambda *_args, **_kwargs: None,
    )

    queue = SlotQueue(
        name="video",
        slot_paths=slot_paths,
        loop_enabled=True,
        shuffle_enabled=False,
    )

    first_asset = {"asset_id": "first", "path": str(tmp_path / "one.mp4")}
    next_asset = {"asset_id": "second", "path": str(tmp_path / "two.mp4")}

    queue.assigned[0] = first_asset
    queue.queue = deque([next_asset])

    await queue._advance_slot(0)

    assert queue.assigned[0] is not None
    assert queue.assigned[0]["asset_id"] == "second"
    assert len(queue.queue) == 1
    recycled = queue.queue[0]
    assert recycled["asset_id"] == "first"
    assert recycled is not first_asset  # ensure recycled copy


@pytest.mark.asyncio
async def test_hot_swap_manager_enqueue_appends_to_queue(tmp_path, monkeypatch):
    """Manager should enqueue assets onto the correct target queue."""

    slot_path = tmp_path / "video_slot_00.media"
    schedule_mock = AsyncMock(return_value=None)
    monkeypatch.setattr("app.streaming.hot_swap.SlotQueue.start", schedule_mock)
    monkeypatch.setattr(
        "app.streaming.playlist_builder.PlaylistBuilder._assign_slot_file",
        lambda *_args, **_kwargs: None,
    )

    queue_state_file = tmp_path / "queue_state.json"
    queue_state_file.write_text("{}", encoding="utf-8")

    playlist_set = PlaylistFileSet(
        stream_dir=tmp_path,
        video_playlist=tmp_path / "video.ffconcat",
        audio_playlist=None,
        mix_mode="video_only",
        video_loop=True,
        audio_loop=False,
        video_assets=[{"asset_id": "initial", "path": str(tmp_path / "initial.mp4")}],
        audio_assets=[],
        video_slots=[slot_path],
        audio_slots=[],
        queue_state_file=queue_state_file,
    )

    manager = StreamHotSwapManager()
    await manager.register_stream("stream-123", playlist_set)

    state = manager._states["stream-123"]
    video_queue = state.queues["video"]
    assert len(video_queue.queue) == 1

    new_asset = {"asset_id": "later", "path": str(tmp_path / "later.mp4")}
    await manager.enqueue_asset("stream-123", "video", new_asset)

    assert video_queue.queue[-1]["asset_id"] == "later"


@pytest.mark.asyncio
async def test_hot_swap_manager_requires_registration():
    """Enqueueing without registration should raise an error."""

    manager = StreamHotSwapManager()
    with pytest.raises(ValueError):
        await manager.enqueue_asset("unknown", "video", {"asset_id": "x"})
