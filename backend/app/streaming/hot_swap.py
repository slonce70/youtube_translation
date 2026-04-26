"""Runtime queue management for hot-swapping playlist assets without FFmpeg restarts."""

from __future__ import annotations

import asyncio
import json
import random
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Tuple

from .playlist_builder import PlaylistFileSet


def _safe_duration(asset: Optional[Dict[str, Any]]) -> float:
    if not asset:
        return 5.0

    meta = asset.get("meta") or {}
    candidates = [
        meta.get("duration"),
        (meta.get("video") or {}).get("duration"),
        (meta.get("audio") or {}).get("duration"),
    ]
    for candidate in candidates:
        try:
            value = float(candidate)
            if value > 0:
                return value
        except (TypeError, ValueError):
            continue
    return 10.0


def _clone_asset(asset: Dict[str, Any]) -> Dict[str, Any]:
    cloned = dict(asset)
    meta = cloned.get("meta")
    if isinstance(meta, dict):
        cloned["meta"] = dict(meta)
    return cloned


@dataclass
class SlotQueue:
    name: str
    slot_paths: List[Path]
    loop_enabled: bool
    shuffle_enabled: bool
    queue: Deque[Dict[str, Any]] = field(default_factory=deque)
    assigned: Dict[int, Optional[Dict[str, Any]]] = field(default_factory=dict)
    playhead_index: int = 0
    pending_task: Optional[asyncio.Task] = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    active: bool = True

    def __post_init__(self) -> None:
        for index in range(len(self.slot_paths)):
            self.assigned.setdefault(index, None)

    async def start(self) -> None:
        if self.pending_task is None:
            self.pending_task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self.active = False
        if self.pending_task:
            self.pending_task.cancel()
            try:
                await self.pending_task
            except asyncio.CancelledError:
                pass

    async def enqueue(self, asset: Dict[str, Any]) -> None:
        async with self.lock:
            self.queue.append(_clone_asset(asset))
            await self._maybe_fill_empty_slot()

    async def replace(
        self, assets: List[Dict[str, Any]], *, loop: bool, shuffle: bool
    ) -> Tuple[List[Optional[Dict[str, Any]]], List[Dict[str, Any]]]:
        async with self.lock:
            self.loop_enabled = loop
            self.shuffle_enabled = shuffle

            normalized_assets = deque(_clone_asset(asset) for asset in assets)

            assigned_assets: List[Optional[Dict[str, Any]]] = []
            for index, slot_path in enumerate(self.slot_paths):
                asset = normalized_assets.popleft() if normalized_assets else None
                await self._assign_slot(index, slot_path, asset)
                assigned_assets.append(_clone_asset(asset) if asset else None)

            self.assigned = {
                index: assigned_assets[index] for index in range(len(self.slot_paths))
            }
            self.queue = deque(normalized_assets)

            if self.playhead_index >= len(self.slot_paths) and self.slot_paths:
                self.playhead_index = 0

            pending_assets = [_clone_asset(asset) for asset in self.queue]

            return assigned_assets, pending_assets

    async def _maybe_fill_empty_slot(self) -> None:
        for index, slot_path in enumerate(self.slot_paths):
            if self.assigned.get(index) is None and self.queue:
                asset = self.queue.popleft()
                await self._assign_slot(index, slot_path, asset)

    async def _assign_slot(
        self, index: int, slot_path: Path, asset: Optional[Dict[str, Any]]
    ) -> None:
        from .playlist_builder import PlaylistBuilder  # Local import to avoid cycle

        PlaylistBuilder._assign_slot_file(slot_path, asset)  # type: ignore[attr-defined]
        self.assigned[index] = _clone_asset(asset) if asset else None

    async def _run(self) -> None:
        try:
            while self.active:
                async with self.lock:
                    current_asset = self.assigned.get(self.playhead_index)
                    duration = _safe_duration(current_asset)
                await asyncio.sleep(duration)
                await asyncio.sleep(0.2)
                async with self.lock:
                    last_index = self.playhead_index
                    self.playhead_index = (self.playhead_index + 1) % len(
                        self.slot_paths
                    )
                    await self._advance_slot(last_index)
        except asyncio.CancelledError:
            pass

    async def _advance_slot(self, slot_index: int) -> None:
        slot_path = self.slot_paths[slot_index]
        asset = self.assigned.get(slot_index)

        if asset and self.loop_enabled:
            recycled_asset = _clone_asset(asset)
            if self.shuffle_enabled:
                queue_items = list(self.queue)
                queue_items.appendleft(recycled_asset)
                random.shuffle(queue_items)
                self.queue = deque(queue_items)
            else:
                self.queue.append(recycled_asset)

        next_asset: Optional[Dict[str, Any]] = None
        if self.queue:
            next_asset = self.queue.popleft()

        await self._assign_slot(slot_index, slot_path, next_asset)


class StreamHotSwapState:
    def __init__(self, stream_id: str, playlist_set: PlaylistFileSet):
        self.stream_id = stream_id
        self.playlist_set = playlist_set
        self.queues: Dict[str, SlotQueue] = {}
        self.queue_state_path = playlist_set.queue_state_file

    async def initialize(self) -> None:
        state_payload = self._load_state()

        if self.playlist_set.video_slots:
            video_state = state_payload.get("video", {})
            queue = SlotQueue(
                name="video",
                slot_paths=self.playlist_set.video_slots,
                loop_enabled=bool(video_state.get("loop", True)),
                shuffle_enabled=bool(video_state.get("shuffle", False)),
            )
            self._populate_queue(queue, self.playlist_set.video_assets, video_state)
            self.queues["video"] = queue
            await queue.start()

        if self.playlist_set.audio_slots:
            audio_state = state_payload.get("audio", {})
            queue = SlotQueue(
                name="audio",
                slot_paths=self.playlist_set.audio_slots,
                loop_enabled=bool(audio_state.get("loop", True)),
                shuffle_enabled=bool(audio_state.get("shuffle", False)),
            )
            self._populate_queue(queue, self.playlist_set.audio_assets, audio_state)
            self.queues["audio"] = queue
            await queue.start()

    async def shutdown(self) -> None:
        await asyncio.gather(
            *(queue.stop() for queue in self.queues.values()), return_exceptions=True
        )
        self.queues.clear()

    async def enqueue_asset(self, target: str, asset: Dict[str, Any]) -> None:
        queue = self.queues.get(target)
        if not queue:
            raise ValueError(
                f"Target '{target}' queue not available for stream {self.stream_id}"
            )
        await queue.enqueue(asset)

    async def replace_queue(
        self,
        target: str,
        assets: List[Dict[str, Any]],
        *,
        loop: bool,
        shuffle: bool,
    ) -> None:
        queue = self.queues.get(target)
        if not queue:
            raise ValueError(
                f"Target '{target}' queue not available for stream {self.stream_id}"
            )

        assigned_assets, pending_assets = await queue.replace(
            assets, loop=loop, shuffle=shuffle
        )

        if not self.queue_state_path:
            return

        state_payload = self._load_state()
        state_payload[target] = {
            "loop": loop,
            "shuffle": shuffle,
            "mix_mode": self.playlist_set.mix_mode,
            "stream_id": self.stream_id,
            "slots": [str(path) for path in queue.slot_paths],
            "assigned": [asset.get("asset_id") for asset in assigned_assets if asset],
            "pending": pending_assets,
        }
        self._write_queue_state(self.queue_state_path, state_payload)

    def _populate_queue(
        self,
        queue: SlotQueue,
        assets: List[Dict[str, Any]],
        state_payload: Dict[str, Any],
    ) -> None:
        pending_assets = state_payload.get("pending")
        if isinstance(pending_assets, list) and pending_assets:
            source = pending_assets
        else:
            source = assets

        for asset in source:
            queue.queue.append(_clone_asset(asset))

    def _load_state(self) -> Dict[str, Any]:
        if self.queue_state_path and self.queue_state_path.exists():
            try:
                return json.loads(self.queue_state_path.read_text(encoding="utf-8"))
            except Exception:
                return {}
        return {}


class StreamHotSwapManager:
    def __init__(self) -> None:
        self._states: Dict[str, StreamHotSwapState] = {}
        self._lock = asyncio.Lock()

    async def register_stream(
        self, stream_id: str, playlist_set: PlaylistFileSet
    ) -> None:
        async with self._lock:
            state = StreamHotSwapState(stream_id, playlist_set)
            await state.initialize()
            self._states[stream_id] = state

    async def unregister_stream(self, stream_id: str) -> None:
        async with self._lock:
            state = self._states.pop(stream_id, None)
        if state:
            await state.shutdown()

    async def enqueue_asset(
        self, stream_id: str, target: str, asset: Dict[str, Any]
    ) -> None:
        async with self._lock:
            state = self._states.get(stream_id)
        if not state:
            raise ValueError(f"Stream {stream_id} is not registered for hot swapping")
        await state.enqueue_asset(target, asset)

    async def replace_queue(
        self,
        stream_id: str,
        target: str,
        assets: List[Dict[str, Any]],
        *,
        loop: bool,
        shuffle: bool,
    ) -> None:
        async with self._lock:
            state = self._states.get(stream_id)
        if not state:
            raise ValueError(f"Stream {stream_id} is not registered for hot swapping")
        await state.replace_queue(target, assets, loop=loop, shuffle=shuffle)

    def get_now_playing(self, stream_id: str) -> Optional[Dict[str, Any]]:
        """Snapshot the current playhead for a registered stream.

        Returns ``None`` when the stream is not registered. Otherwise returns
        a dict with the current asset, the next asset (looking at the
        playhead+1 slot or the head of the pending queue), the queue depth,
        and total seconds remaining in the queue if durations are known.

        Track 5b/C #1 (2026-04-26): operator panel needs "now playing" +
        "up next" without leaving the page. The data has been tracked in
        ``SlotQueue.assigned`` + ``SlotQueue.queue`` since hot-swap shipped;
        this method is the public read-only window.
        """
        state = self._states.get(stream_id)
        if not state:
            return None

        # Prefer the video queue if a stream has both; audio-only streams
        # fall back to the audio queue.
        queue = state.queues.get("video") or state.queues.get("audio")
        if not queue or not queue.slot_paths:
            return None

        slots_count = len(queue.slot_paths)
        current_index = queue.playhead_index % slots_count if slots_count else 0
        current = queue.assigned.get(current_index)

        # Next: head of pending queue if any; else the next assigned slot;
        # else the current slot (when looping a single-asset queue).
        next_asset: Optional[Dict[str, Any]] = None
        if queue.queue:
            next_asset = queue.queue[0]
        elif slots_count > 1:
            next_asset = queue.assigned.get((current_index + 1) % slots_count)
        elif queue.loop_enabled:
            next_asset = current

        def _summarize(asset: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
            if not asset:
                return None
            return {
                "asset_id": asset.get("asset_id"),
                "filename": asset.get("filename"),
                "duration_seconds": _safe_duration(asset),
            }

        # Queue-remaining covers the pending deque only; the looping
        # behaviour is open-ended ("∞") and signaled separately.
        remaining_seconds = sum(_safe_duration(item) for item in queue.queue)

        return {
            "target": queue.name,
            "loop_enabled": queue.loop_enabled,
            "shuffle_enabled": queue.shuffle_enabled,
            "current": _summarize(current),
            "next": _summarize(next_asset),
            "queue_remaining_count": len(queue.queue),
            "queue_remaining_seconds": remaining_seconds,
            "playhead_index": current_index,
            "slots_count": slots_count,
        }


hot_swap_manager = StreamHotSwapManager()


__all__ = ["hot_swap_manager", "StreamHotSwapManager"]
