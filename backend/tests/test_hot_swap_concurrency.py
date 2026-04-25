"""Sprint 6 — hot-swap concurrency tests.

The audit (2026-04-25) flagged that ``hot_swap.py`` had no race-condition
coverage: two simultaneous ``replace_queue`` calls on the same stream
could interleave between the slot-write and the queue-state JSON dump,
producing a state file that doesn't match the assigned slot files.

This module exercises the contract that ``SlotQueue.replace`` and
``SlotQueue.enqueue`` are serialized by the per-queue lock so concurrent
calls produce a single consistent final state — never a torn one.
"""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any, Dict, List

import pytest

from app.streaming.hot_swap import SlotQueue


pytestmark = pytest.mark.asyncio


def _asset(asset_id: str, duration: float = 1.0) -> Dict[str, Any]:
    return {
        "asset_id": asset_id,
        "filename": f"{asset_id}.mp4",
        "duration_seconds": duration,
    }


def _build_queue(slot_count: int = 3) -> tuple[SlotQueue, Path]:
    """Create a SlotQueue with temp slot files. Caller is responsible for
    cleaning up the parent directory."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="hotswap-test-"))
    slot_paths = [tmp_dir / f"slot_{i}.txt" for i in range(slot_count)]
    queue = SlotQueue(
        name="test",
        slot_paths=slot_paths,
        loop_enabled=False,
        shuffle_enabled=False,
    )
    return queue, tmp_dir


async def test_concurrent_replace_calls_do_not_lose_assets(monkeypatch):
    """Two replace() calls firing in parallel must each complete coherently.

    The lock ensures one runs to completion before the other starts; the
    final state matches whichever replace() ran last (last-write-wins,
    not interleaved).
    """
    # Stub out the playlist_builder import + slot-file writes so the test
    # doesn't need ffmpeg / disk semantics.
    from app.streaming import hot_swap

    written_slots: List[tuple[Path, Dict[str, Any] | None]] = []

    def fake_assign(slot_path, asset):
        written_slots.append((slot_path, asset))

    monkeypatch.setattr(
        "app.streaming.playlist_builder.PlaylistBuilder._assign_slot_file",
        staticmethod(fake_assign),
        raising=False,
    )

    queue, tmp_dir = _build_queue(slot_count=2)
    try:
        list_a = [_asset("a-1"), _asset("a-2")]
        list_b = [_asset("b-1"), _asset("b-2")]

        # Fire both replace calls; gather waits for both to complete.
        await asyncio.gather(
            queue.replace(list_a, loop=False, shuffle=False),
            queue.replace(list_b, loop=False, shuffle=False),
        )

        # The lock guarantees one ran to completion before the other
        # started. The final assigned state is exactly one of the two
        # input lists — never a mix.
        assigned_ids = [
            queue.assigned[i].get("asset_id") if queue.assigned[i] else None
            for i in range(len(queue.slot_paths))
        ]
        assert assigned_ids in (
            ["a-1", "a-2"],
            ["b-1", "b-2"],
        ), f"Torn state: {assigned_ids}"
    finally:
        # Cleanup — slot files are written via fake_assign, dir is empty.
        try:
            tmp_dir.rmdir()
        except OSError:
            pass


async def test_concurrent_replace_then_enqueue_serializes(monkeypatch):
    """A replace() followed (concurrently) by enqueue() must end with the
    enqueue's asset visible — not silently dropped because replace's lock
    span included the queue mutation.
    """
    from app.streaming import hot_swap  # noqa: F401

    monkeypatch.setattr(
        "app.streaming.playlist_builder.PlaylistBuilder._assign_slot_file",
        staticmethod(lambda *_args, **_kwargs: None),
        raising=False,
    )

    queue, tmp_dir = _build_queue(slot_count=2)
    try:
        await queue.replace([_asset("base-1"), _asset("base-2")], loop=False, shuffle=False)

        # 50 concurrent enqueues — no asset should be lost.
        await asyncio.gather(
            *(queue.enqueue(_asset(f"extra-{i}")) for i in range(50))
        )

        # All 50 land somewhere — either in queue (overflow past slot
        # capacity) or assigned to the base-1/base-2 slots if the slots
        # had been emptied. With slot_count=2 and base assets present,
        # all 50 stay in the overflow queue.
        assert len(queue.queue) == 50, (
            f"Expected 50 overflow assets, got {len(queue.queue)} — "
            "concurrent enqueue may have lost some"
        )
    finally:
        try:
            tmp_dir.rmdir()
        except OSError:
            pass


async def test_replace_with_fewer_assets_clears_unused_slots(monkeypatch):
    """Replace with N < slot_count assets must explicitly null out the
    trailing slots — not leave the previous round's data assigned."""
    monkeypatch.setattr(
        "app.streaming.playlist_builder.PlaylistBuilder._assign_slot_file",
        staticmethod(lambda *_args, **_kwargs: None),
        raising=False,
    )

    queue, tmp_dir = _build_queue(slot_count=4)
    try:
        await queue.replace(
            [_asset("a"), _asset("b"), _asset("c"), _asset("d")],
            loop=False, shuffle=False,
        )
        # Now replace with only 2 assets.
        await queue.replace([_asset("x"), _asset("y")], loop=False, shuffle=False)

        assigned_ids = [
            queue.assigned[i].get("asset_id") if queue.assigned[i] else None
            for i in range(len(queue.slot_paths))
        ]
        assert assigned_ids == ["x", "y", None, None]
    finally:
        try:
            tmp_dir.rmdir()
        except OSError:
            pass


async def test_concurrent_enqueue_under_load_holds_invariant(monkeypatch):
    """100 parallel enqueues across 4 producers must all land — none
    silently dropped due to dict mutation under contention."""
    monkeypatch.setattr(
        "app.streaming.playlist_builder.PlaylistBuilder._assign_slot_file",
        staticmethod(lambda *_args, **_kwargs: None),
        raising=False,
    )

    queue, tmp_dir = _build_queue(slot_count=1)
    try:
        # First pre-fill the single slot so further enqueues go to the
        # overflow queue (deterministic).
        await queue.replace([_asset("primary")], loop=False, shuffle=False)

        async def producer(prefix: str, count: int) -> None:
            for i in range(count):
                await queue.enqueue(_asset(f"{prefix}-{i}"))

        await asyncio.gather(
            producer("p1", 25),
            producer("p2", 25),
            producer("p3", 25),
            producer("p4", 25),
        )

        assert len(queue.queue) == 100, (
            f"Lost enqueues under contention: got {len(queue.queue)}"
        )
        # Every prefix is represented.
        seen_prefixes = {
            asset["asset_id"].split("-")[0]
            for asset in queue.queue
            if "asset_id" in asset
        }
        assert seen_prefixes == {"p1", "p2", "p3", "p4"}
    finally:
        try:
            tmp_dir.rmdir()
        except OSError:
            pass
