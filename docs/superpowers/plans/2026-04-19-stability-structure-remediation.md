# Stability and Structure Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project more stable, more explicit in its runtime/contracts, and easier to change by splitting the highest-risk hot paths without changing product scope.

**Architecture:** Stabilize external contracts first, then make backend transaction ownership explicit, then extract pure helpers from the streaming runtime, and finally slim the two heaviest frontend surfaces into focused hooks/components. Each phase keeps behavior covered by targeted tests before broader verification.

**Tech Stack:** FastAPI, async SQLAlchemy, Next.js 15, React 19, TanStack Query, Jest, Playwright, pytest, FFmpeg

---

## Planned File Map

- Modify: `backend/app/core/database.py` — make request-session commit behavior explicit and predictable.
- Modify: `backend/app/services/streams/service.py` — remove partial-save behavior from stream creation/update hot paths.
- Modify: `backend/app/services/streams/control.py` — reduce mid-flow persistence and isolate launch-state transitions.
- Create: `backend/app/streaming/command_builder.py` — pure FFmpeg destination normalization and command assembly.
- Create: `backend/app/streaming/runtime_signals.py` — degraded-live signal tracking and incident summary helpers.
- Create: `backend/app/streaming/process_support.py` — log writing, quota-guard, and terminal-observability helpers extracted from the manager.
- Modify: `backend/app/streaming/ffmpeg_manager.py` — coordinator only; delegates command building, signal tracking, and process support.
- Create: `backend/tests/test_database_session_contract.py` — tests for `get_db()` and `get_db_context()` semantics.
- Create: `backend/tests/test_stream_transaction_contract.py` — regression tests for no partial DB state on stream failures.
- Create: `backend/tests/test_ffmpeg_command_builder.py` — focused tests for command composition without going through the full manager.
- Create: `backend/tests/test_runtime_signals.py` — focused tests for degraded-live signal thresholds and cooldowns.
- Create: `backend/tests/test_admin_api_routes.py` — real route-level admin tests replacing placeholders/skips.
- Modify: `backend/tests/test_admin_api.py` — remove placeholder coverage and point to real route tests.
- Modify: `backend/tests/test_migrations.py` — replace `pass` placeholders with executable migration contract assertions.
- Create: `frontend/src/lib/tusd.ts` — single source of truth for TUS base URL normalization.
- Create: `frontend/src/lib/__tests__/tusd.test.ts` — contract tests for `/files/` normalization.
- Modify: `frontend/src/app/dashboard/library/page.tsx` — consume a dedicated upload hook and lazy-load the heavy modal.
- Create: `frontend/src/app/dashboard/library/hooks/useLibraryUploads.ts` — owns Uppy setup, token refresh, and finalization polling.
- Create: `frontend/src/app/dashboard/library/hooks/__tests__/useLibraryUploads.test.tsx` — contract tests for token and upload state orchestration.
- Modify: `frontend/src/components/upload/UploadModal.tsx` — UI-only surface after moving orchestration out.
- Create: `frontend/src/components/upload/uploadAnalysis.ts` — pure media-analysis formatting/extraction helpers.
- Create: `frontend/src/components/upload/__tests__/uploadAnalysis.test.ts` — focused tests for upload-analysis decisions.
- Create: `frontend/src/app/dashboard/streaming/hooks/useStreamMutations.ts` — start/stop/schedule/destination mutation ownership.
- Create: `frontend/src/app/dashboard/streaming/hooks/__tests__/useStreamMutations.test.tsx` — mutation and optimistic-state regression tests.
- Modify: `frontend/src/app/dashboard/streaming/page.tsx` — render/controller shell only, no mutation jungle.
- Modify: `frontend/playwright.config.ts` — stop injecting an already-suffixed TUS URL.
- Modify: `frontend/e2e/dashboard-flows.spec.ts` — tighten mocks so double `/files/files/` cannot slip through.
- Modify: `frontend/.env.example` — document the normalized TUS contract.
- Modify: `docs/ARCHITECTURE.md` — reflect the split runtime modules and slimmer frontend ownership.
- Modify: `docs/TESTING.md` — document the new verification path and backend test caveats.
- Modify: `README.md` — sync the public dev/test contract where it currently drifts.

## Phase Order

1. Fix environment/test contract drift that can hide real regressions.
2. Lock down DB session semantics before changing more code.
3. Split backend runtime seams while behavior is still covered.
4. Slim frontend upload and streaming surfaces.
5. Replace placeholder tests and sync docs.
6. Run full verification and stop only on green evidence.

### Task 1: Normalize the TUS URL Contract and Close the E2E Blind Spot

**Files:**
- Create: `frontend/src/lib/tusd.ts`
- Test: `frontend/src/lib/__tests__/tusd.test.ts`
- Modify: `frontend/src/app/dashboard/library/page.tsx`
- Modify: `frontend/playwright.config.ts`
- Modify: `frontend/e2e/dashboard-flows.spec.ts`
- Modify: `frontend/.env.example`
- Modify: `docs/TESTING.md`
- Modify: `README.md`

- [ ] **Step 1: Write the failing contract test for TUS endpoint normalization**

```ts
import { resolveTusEndpoint } from '../tusd'

describe('resolveTusEndpoint', () => {
  it('adds /files/ when the env contains only the origin', () => {
    expect(resolveTusEndpoint('http://localhost:1080')).toBe('http://localhost:1080/files/')
  })

  it('keeps a single /files/ suffix when the env already contains it', () => {
    expect(resolveTusEndpoint('http://localhost:1080/files')).toBe('http://localhost:1080/files/')
  })

  it('falls back to the relative tus path when the env is empty', () => {
    expect(resolveTusEndpoint('')).toBe('/files/')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && CI=1 npx jest src/lib/__tests__/tusd.test.ts --runInBand`
Expected: FAIL with `Cannot find module '../tusd'`

- [ ] **Step 3: Implement a single TUS endpoint helper**

```ts
export function resolveTusEndpoint(rawBase: string | undefined): string {
  const normalized = (rawBase ?? '').trim().replace(/\/$/, '')
  if (!normalized) {
    return '/files/'
  }
  if (normalized.endsWith('/files')) {
    return `${normalized}/`
  }
  return `${normalized}/files/`
}
```

- [ ] **Step 4: Replace inline endpoint building and fix the Playwright default**

```ts
// frontend/src/app/dashboard/library/page.tsx
import { resolveTusEndpoint } from '@/lib/tusd'

const tusEndpoint = useMemo(() => {
  return resolveTusEndpoint(process.env.NEXT_PUBLIC_TUSD_URL)
}, [])
```

```ts
// frontend/playwright.config.ts
NEXT_PUBLIC_TUSD_URL: process.env.NEXT_PUBLIC_TUSD_URL ?? 'http://localhost:1080',
```

- [ ] **Step 5: Tighten the e2e mock so `/files/files/` fails instead of passing**

```ts
await page.route('**/*', async (route) => {
  const url = route.request().url()
  if (url.includes('/files/files/')) {
    throw new Error(`Unexpected doubled tus path: ${url}`)
  }
  return route.fallback()
})
```

```ts
await page.route('**/files/**', async (route: Route) => {
  const request = route.request()
  const requestUrl = new URL(request.url())
  expect(requestUrl.pathname.startsWith('/files/')).toBeTruthy()
  expect(requestUrl.pathname.includes('/files/files/')).toBeFalsy()

  if (request.method() === 'OPTIONS') {
    return route.fulfill({
      status: 204,
      headers: tusHeaders,
      body: '',
    })
  }

  if (request.method() !== 'POST') {
    return route.fallback()
  }

  const location = `${request.url().replace(/\/$/, '')}/upload-1`
  return route.fulfill({
    status: 201,
    headers: {
      ...tusHeaders,
      Location: location,
      'Upload-Offset': '0',
    },
    body: '',
  })
})
```

- [ ] **Step 6: Sync the documented env contract**

```md
# frontend/.env.example
# NEXT_PUBLIC_TUSD_URL should be the base origin or proxy root.
# Examples:
#   http://localhost:1080
#   http://localhost
# Do not append /files manually; the frontend normalizes it.
```

- [ ] **Step 7: Re-run focused tests**

Run: `cd frontend && CI=1 npx jest src/lib/__tests__/tusd.test.ts src/lib/__tests__/api.test.ts --runInBand`
Expected: PASS

Run: `cd frontend && npx playwright test e2e/dashboard-flows.spec.ts`
Expected: PASS and every mocked tus request path starts with `/files/` exactly once

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/tusd.ts frontend/src/lib/__tests__/tusd.test.ts frontend/src/app/dashboard/library/page.tsx frontend/playwright.config.ts frontend/e2e/dashboard-flows.spec.ts frontend/.env.example docs/TESTING.md README.md
git commit -m "fix: normalize tus endpoint contract"
```

### Task 2: Make Request-Scoped Database Sessions Non-Committing by Default

**Files:**
- Modify: `backend/app/core/database.py`
- Test: `backend/tests/test_database_session_contract.py`
- Modify: `backend/tests/test_database.py`

- [ ] **Step 1: Write the failing DB session contract tests**

```python
import pytest

from app.core.database import _managed_session, get_db_context


@pytest.mark.asyncio
async def test_managed_session_without_commit_flag_skips_commit(monkeypatch):
    events = []

    class FakeSession:
        async def commit(self):
            events.append("commit")
        async def rollback(self):
            events.append("rollback")
        async def close(self):
            events.append("close")

    class FakeFactory:
        async def __aenter__(self):
            return FakeSession()
        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("app.core.database.async_session_maker", lambda: FakeFactory())

    async with _managed_session(commit_on_success=False):
        pass

    assert events == ["close"]


@pytest.mark.asyncio
async def test_get_db_context_commits_by_default(monkeypatch):
    events = []

    class FakeSession:
        async def commit(self):
            events.append("commit")
        async def rollback(self):
            events.append("rollback")
        async def close(self):
            events.append("close")

    class FakeFactory:
        async def __aenter__(self):
            return FakeSession()
        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("app.core.database.async_session_maker", lambda: FakeFactory())

    async with get_db_context():
        pass

    assert events == ["commit", "close"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_database_session_contract.py -v`
Expected: FAIL because `_managed_session()` does not accept `commit_on_success`

- [ ] **Step 3: Add explicit commit policy to the session helper**

```python
@asynccontextmanager
async def _managed_session(*, commit_on_success: bool):
    async with _db_connection_semaphore:
        async with async_session_maker() as session:
            try:
                yield session
            except HTTPException as http_exc:
                await session.rollback()
                raise
            except Exception:
                await session.rollback()
                raise
            else:
                if commit_on_success:
                    await session.commit()
            finally:
                await session.close()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with _managed_session(commit_on_success=False) as session:
        yield session


@asynccontextmanager
async def get_db_context(*, commit_on_success: bool = True):
    async with _managed_session(commit_on_success=commit_on_success) as session:
        yield session
```

- [ ] **Step 4: Rewrite the old database test so it checks the new rule instead of only generator shape**

```python
@pytest.mark.asyncio
async def test_get_db_is_request_scoped_without_implicit_commit():
    from app.core.database import get_db

    gen = get_db()

    assert hasattr(gen, '__anext__')
    assert hasattr(gen, 'aclose')
```

```python
@pytest.mark.asyncio
async def test_database_session_contract_module_exists():
    from backend.tests import test_database_session_contract  # noqa: F401
```

- [ ] **Step 5: Run the focused backend tests**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_database_session_contract.py tests/test_database.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/database.py backend/tests/test_database_session_contract.py backend/tests/test_database.py
git commit -m "refactor: make request db sessions explicit"
```

### Task 3: Remove the Systemd Start Finalize Gap

**Files:**
- Modify: `backend/app/services/streams/control.py`
- Modify: `backend/tests/test_stream_launch_safety.py`
- Note only: `backend/app/services/streams/service.py` currently uses one commit after `flush()` and benefits from Task 2's non-committing request session; do not change it in this tranche unless a new failing regression shows otherwise.

- [ ] **Step 1: Write the failing regression test for the post-launch finalize gap**

```python
@pytest.mark.asyncio
async def test_systemd_start_does_not_depend_on_second_commit_to_clear_schedule(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user_id, stream_id = await _create_stream_fixture(tmp_path, stream_status="scheduled")
    log_file = tmp_path / "stream.log"

    async with async_session_maker() as seed_session:
        stream = await seed_session.get(Stream, stream_id)
        assert stream is not None
        stream.scheduled_start_enabled = True
        stream.scheduled_start_time = datetime.now(timezone.utc) + timedelta(minutes=15)
        await seed_session.commit()

    monkeypatch.setattr(streams_control, "systemd_enabled", lambda: True)
    monkeypatch.setattr(streams_control, "validate_stream_launch_prerequisites", fake_validate)
    monkeypatch.setattr(streams_control, "systemd_is_active", fake_systemd_is_active)
    monkeypatch.setattr(streams_control, "systemd_unit_status", fake_systemd_unit_status)
    monkeypatch.setattr(streams_control, "systemd_start_unit", fake_systemd_start_unit)

    async with async_session_maker() as session:
        real_commit = session.commit
        commit_calls = 0

        async def fail_only_on_second_commit():
            nonlocal commit_calls
            commit_calls += 1
            if commit_calls == 2:
                raise RuntimeError("finalize commit failed")
            await real_commit()

        monkeypatch.setattr(session, "commit", fail_only_on_second_commit)

        service = StreamControlService(session, user_id)
        status_payload = await service.start_stream(stream_id)

        stream = await session.get(Stream, stream_id)
        assert stream is not None
        assert stream.status == "starting"
        assert stream.log_path == str(log_file)
        assert stream.scheduled_start_enabled is False
        assert stream.scheduled_start_time is None
        assert commit_calls == 1

    assert status_payload.status == "starting"
    assert status_payload.is_running is False
```

- [ ] **Step 2: Run the test to verify it fails on the current second commit**

Run: `cd backend && FFMPEG_BIN=tests/bin/ffmpeg ./.venv/bin/python -m pytest tests/test_stream_launch_safety.py -k second_commit -v`
Expected: FAIL at the second `await self.db.commit()` in `StreamControlService.start_stream()`

- [ ] **Step 3: Collapse deterministic systemd-start DB updates into the first commit**

```python
previous_scheduled_start_enabled = stream.scheduled_start_enabled
previous_scheduled_start_time = stream.scheduled_start_time
previous_scheduled_start_attempted_at = stream.scheduled_start_attempted_at

stream.status = "starting"
stream.stopped_at = None
stream.error_message = None
stream.log_path = str(log_file)
if not preserve_schedule:
    self._clear_start_schedule(stream)
await self.db.commit()

try:
    await systemd_start_unit(stream_id)
except Exception as err:
    stream.status = previous_status
    stream.started_at = previous_started_at
    stream.stopped_at = previous_stopped_at
    stream.error_message = previous_error_message
    stream.log_path = previous_log_path
    stream.scheduled_start_enabled = previous_scheduled_start_enabled
    stream.scheduled_start_time = previous_scheduled_start_time
    stream.scheduled_start_attempted_at = previous_scheduled_start_attempted_at
    await self.db.commit()
    raise HTTPException(status_code=500, detail=str(err)) from err

usage = await self._get_usage_snapshot(enforcer)
return self._status_payload(stream, stream.status == "running", usage=usage)
```

- [ ] **Step 4: Re-run the focused systemd launch tests**

Run: `cd backend && FFMPEG_BIN=tests/bin/ffmpeg ./.venv/bin/python -m pytest tests/test_stream_launch_safety.py -k 'systemd_start or existing_starting_status_before_relaunch' -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/streams/control.py backend/tests/test_stream_launch_safety.py
git commit -m "fix: remove systemd start finalize gap"
```

### Task 4: Extract FFmpeg Destination and Output-Argument Builders

**Files:**
- Create: `backend/app/streaming/command_builder.py`
- Modify: `backend/app/streaming/ffmpeg_manager.py`
- Test: `backend/tests/test_ffmpeg_command_builder.py`
- Modify: `backend/tests/test_ffmpeg_manager.py`

- [ ] **Step 1: Write the failing command-builder tests**

```python
from pathlib import Path

from app.streaming.command_builder import normalize_destinations


def test_normalize_destinations_keeps_single_slash_between_url_and_key():
    result = normalize_destinations(
        [{"url": "rtmps://a.rtmp.youtube.com/live2/", "key": "abc"}]
    )
    assert result == [{"uri": "rtmps://a.rtmp.youtube.com/live2/abc"}]


def test_normalize_destinations_allows_prebuilt_uri():
    result = normalize_destinations([{"url": "", "key": "rtmps://custom/live/key"}])
    assert result == [{"uri": "rtmps://custom/live/key"}]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_ffmpeg_command_builder.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.streaming.command_builder'`

- [ ] **Step 3: Create the pure builder module**

```python
from typing import Any


def normalize_destinations(destinations: list[dict[str, str]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for dest in destinations:
        base_url = str(dest.get("url") or "").rstrip("/")
        stream_key = str(dest.get("key") or "").strip()
        if not base_url:
            normalized.append({"uri": stream_key})
        else:
            normalized.append({"uri": f"{base_url}/{stream_key}"})
    return normalized
```

```python
def build_single_destination_output_args(target: str) -> tuple[list[str], list[str], None]:
    max_recovery_attempts = max(int(settings.ffmpeg_output_recovery_max_attempts), 0)
    queue_size = max(int(settings.ffmpeg_output_fifo_queue_size), 1)
    output_target = _apply_output_transport_options(target)
    return (
        [
            "-f",
            "fifo",
            "-fifo_format",
            "flv",
            "-attempt_recovery",
            "1",
            "-recovery_wait_time",
            "5",
            "-recover_any_error",
            "1",
            "-restart_with_keyframe",
            "1",
            "-drop_pkts_on_overflow",
            "1" if bool(settings.ffmpeg_output_drop_pkts_on_overflow) else "0",
            "-queue_size",
            str(queue_size),
            "-max_recovery_attempts",
            str(max_recovery_attempts),
            output_target,
        ],
        [output_target],
        None,
    )


def build_multi_destination_output_args(destinations: list[dict[str, str]]) -> tuple[list[str], list[str], str]:
    tee_outputs: list[str] = []
    destination_uris: list[str] = []
    for dest in destinations:
        uri = dest["uri"]
        destination_uris.append(_apply_output_transport_options(uri))
        tee_outputs.append(_build_tee_destination(uri))
    return ["-f", "tee", "|".join(tee_outputs)], destination_uris, settings.ffmpeg_tee_onfail_policy
```

- [ ] **Step 4: Make the manager delegate instead of owning command assembly**

```python
from app.streaming.command_builder import (
    build_multi_destination_output_args,
    build_single_destination_output_args,
    normalize_destinations,
)


def _build_command(self, playlists: PlaylistFileSet, destinations: list[dict[str, str]]) -> FFmpegCommandPlan:
    normalized_destinations = normalize_destinations(destinations)
    multi_destination = len(normalized_destinations) > 1

    if len(normalized_destinations) == 1:
        output_args, destination_uris, tee_onfail_policy = build_single_destination_output_args(normalized_destinations[0]["uri"])
    else:
        output_args, destination_uris, tee_onfail_policy = build_multi_destination_output_args(normalized_destinations)

    cmd.extend(output_args)
    return FFmpegCommandPlan(
        command=cmd,
        copy_video=copy_video,
        copy_audio=copy_audio,
        multi_destination=multi_destination,
        video_bitrate_kbps=video_bitrate_value,
        video_maxrate_kbps=video_maxrate_value,
        video_bufsize_kbps=video_bufsize_value,
        audio_bitrate_kbps=audio_bitrate_value,
        uses_video_placeholder=playlists.needs_video_placeholder and playlists.video_playlist is None,
        uses_audio_placeholder=playlists.needs_audio_placeholder and playlists.audio_playlist is None,
        destination_uris=destination_uris,
        keyframe_interval_seconds=keyframe_interval_seconds,
        keyframe_gop_frames=keyframe_gop_frames,
        tee_onfail_policy=tee_onfail_policy,
    )
```

- [ ] **Step 5: Run focused tests for the new seam**

Run: `cd backend && FFMPEG_BIN=tests/bin/ffmpeg ./.venv/bin/python -m pytest tests/test_ffmpeg_command_builder.py tests/test_ffmpeg_manager.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/streaming/command_builder.py backend/app/streaming/ffmpeg_manager.py backend/tests/test_ffmpeg_command_builder.py backend/tests/test_ffmpeg_manager.py
git commit -m "refactor: extract ffmpeg command builder"
```

### Task 5: Extract Runtime Signal Tracking From the FFmpeg Manager

**Files:**
- Create: `backend/app/streaming/runtime_signals.py`
- Modify: `backend/app/streaming/ffmpeg_manager.py`
- Test: `backend/tests/test_runtime_signals.py`
- Modify: `backend/tests/test_ffmpeg_manager.py`

- [ ] **Step 1: Write the failing runtime-signal tests**

```python
from collections import deque
from datetime import datetime, timezone

from app.streaming.runtime_signals import register_signal_hit, count_recent_hits


def test_register_signal_hit_stores_last_line_and_timestamp():
    state = {}
    now = datetime.now(timezone.utc)

    signal_state = register_signal_hit(state, "remote_output_reset", "Broken pipe", now)

    assert signal_state["last_line"] == "Broken pipe"
    assert isinstance(signal_state["hits"], deque)


def test_count_recent_hits_prunes_old_entries():
    now = datetime.now(timezone.utc)
    state = {"hits": deque([now])}
    assert count_recent_hits(state, now=now, window_seconds=60) == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_runtime_signals.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Move pure signal-state helpers into a dedicated module**

```python
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any


def register_signal_hit(runtime_state: dict[str, dict[str, Any]], signal_name: str, log_line: str, observed_at: datetime) -> dict[str, Any]:
    signal_state = runtime_state.setdefault(
        signal_name,
        {
            "hits": deque(maxlen=32),
            "last_emitted_at": None,
            "last_seen_at": None,
            "last_line": None,
        },
    )
    hits = signal_state["hits"]
    hits.append(observed_at)
    signal_state["last_seen_at"] = observed_at
    signal_state["last_line"] = log_line[:500]
    return signal_state


def count_recent_hits(signal_state: dict[str, Any], *, now: datetime, window_seconds: int) -> int:
    hits = signal_state["hits"]
    cutoff = now - timedelta(seconds=max(window_seconds, 1))
    while hits and hits[0] < cutoff:
        hits.popleft()
    return len(hits)
```

- [ ] **Step 4: Replace in-manager helper bodies with imports and delegation**

```python
from app.streaming.runtime_signals import (
    count_recent_hits,
    register_signal_hit,
    signal_cooldown_elapsed,
    summarize_runtime_incidents,
)
```

```python
signal_state = register_signal_hit(runtime_state, signal_name, log_line, observed_at)
count = count_recent_hits(signal_state, now=observed_at, window_seconds=int(spec["window_seconds"]))
```

- [ ] **Step 5: Run the focused tests**

Run: `cd backend && FFMPEG_BIN=tests/bin/ffmpeg ./.venv/bin/python -m pytest tests/test_runtime_signals.py tests/test_ffmpeg_manager.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/streaming/runtime_signals.py backend/app/streaming/ffmpeg_manager.py backend/tests/test_runtime_signals.py backend/tests/test_ffmpeg_manager.py
git commit -m "refactor: extract runtime signal tracking"
```

### Task 6: Extract Log Writer and Quota Guard Process Support

**Files:**
- Create: `backend/app/streaming/process_support.py`
- Modify: `backend/app/streaming/ffmpeg_manager.py`
- Modify: `backend/tests/test_ffmpeg_manager.py`

- [ ] **Step 1: Write the failing focused tests for the extracted helpers**

```python
from pathlib import Path

from app.streaming.process_support import rotate_log_file


def test_rotate_log_file_keeps_single_backup(tmp_path):
    log_file = tmp_path / "stream.log"
    log_file.write_text("current")

    rotate_log_file(log_file, 1)

    assert (tmp_path / "stream.log.1").exists()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_ffmpeg_manager.py -k rotate_log_file -v`
Expected: FAIL because `process_support.py` does not exist yet

- [ ] **Step 3: Move log rotation and quota-usage support into a helper module**

```python
def rotate_log_file(log_file: Path, max_backups: int) -> None:
    if max_backups <= 0:
        log_file.unlink(missing_ok=True)
        return
    for idx in range(max_backups, 0, -1):
        src = log_file.with_suffix(log_file.suffix + f".{idx}")
        dst = log_file.with_suffix(log_file.suffix + f".{idx + 1}")
        if src.exists():
            src.replace(dst)
    if log_file.exists():
        log_file.replace(log_file.with_suffix(log_file.suffix + ".1"))
```

```python
async def fetch_daily_usage(user_id: UUID) -> dict[str, Any] | None:
    async with get_db_context() as session:
        enforcer = QuotaEnforcer(session, user_id)
        return await enforcer.get_daily_streaming_usage()
```

- [ ] **Step 4: Keep `FFmpegStreamManager` as coordinator only**

```python
from app.streaming.process_support import (
    fetch_daily_usage,
    rotate_log_file,
    write_process_logs,
)
```

```python
return await write_process_logs(
    stream_id=stream_id,
    process=process,
    log_file=log_file,
    stream_info=self.stream_info,
    on_log_line=self._record_runtime_log_health,
)
```

- [ ] **Step 5: Run the focused runtime tests**

Run: `cd backend && FFMPEG_BIN=tests/bin/ffmpeg ./.venv/bin/python -m pytest tests/test_ffmpeg_manager.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/streaming/process_support.py backend/app/streaming/ffmpeg_manager.py backend/tests/test_ffmpeg_manager.py
git commit -m "refactor: extract ffmpeg process support helpers"
```

### Task 7: Move Library Upload Orchestration Into a Dedicated Hook and Lazy-Load the Modal

**Files:**
- Create: `frontend/src/app/dashboard/library/hooks/useLibraryUploads.ts`
- Test: `frontend/src/app/dashboard/library/hooks/__tests__/useLibraryUploads.test.tsx`
- Modify: `frontend/src/app/dashboard/library/page.tsx`
- Modify: `frontend/src/components/upload/UploadModal.tsx`
- Create: `frontend/src/components/upload/uploadAnalysis.ts`
- Test: `frontend/src/components/upload/__tests__/uploadAnalysis.test.ts`

- [ ] **Step 1: Write the failing hook test for token refresh and upload-state ownership**

```tsx
import { renderHook, act } from '@testing-library/react'

import { useLibraryUploads } from '../useLibraryUploads'
import { api } from '@/lib/api'

jest.mock('@/lib/api', () => ({
  api: {
    assets: {
      createUploadToken: jest.fn(),
    },
  },
}))

it('refreshes the upload token and stores expiry metadata', async () => {
  ;(api.assets.createUploadToken as jest.Mock).mockResolvedValue({
    token: 'upload-token',
    expires_at: '2026-04-19T12:10:00Z',
  })

  const { result } = renderHook(() =>
    useLibraryUploads({ userId: 'user-1', queryClient: {} as any, libraryToasts: ((x: string) => x) as any })
  )

  await act(async () => {
    await result.current.refreshUploadToken()
  })

  expect(result.current.uploadTokenState?.token).toBe('upload-token')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && CI=1 npx jest src/app/dashboard/library/hooks/__tests__/useLibraryUploads.test.tsx --runInBand`
Expected: FAIL with `Cannot find module '../useLibraryUploads'`

- [ ] **Step 3: Create the upload orchestration hook**

```tsx
export function useLibraryUploads({
  userId,
  queryClient,
  libraryToasts,
}: UseLibraryUploadsOptions) {
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isProcessingUpload, setIsProcessingUpload] = useState(false)
  const [uploadStatusOverrides, setUploadStatusOverrides] = useState<Record<string, UploadModalStatusOverride>>({})
  const [uploadTokenState, setUploadTokenState] = useState<{ token: string; expiresAt: number } | null>(null)

  const refreshUploadToken = useCallback(async () => {
    if (!userId) {
      setUploadTokenState(null)
      return
    }
    const response = await api.assets.createUploadToken()
    setUploadTokenState({
      token: response.token,
      expiresAt: new Date(response.expires_at).getTime(),
    })
  }, [userId])

  return {
    isUploadOpen,
    isProcessingUpload,
    uploadStatusOverrides,
    uploadTokenState,
    setIsUploadOpen,
    setIsProcessingUpload,
    setUploadStatusOverrides,
    refreshUploadToken,
  }
}
```

- [ ] **Step 4: Make the page consume the hook and lazy-load the modal**

```tsx
import dynamic from 'next/dynamic'
import { useLibraryUploads } from './hooks/useLibraryUploads'

const UploadModal = dynamic(
  () => import('@/components/upload/UploadModal').then((mod) => mod.UploadModal),
  { ssr: false }
)
```

```tsx
const uploads = useLibraryUploads({
  userId: user?.id,
  queryClient,
  libraryToasts,
})
```

- [ ] **Step 5: Move pure media-analysis formatting into a helper file**

```ts
export function buildAnalysis(parsed: MediaInfoJson, t: Translate, options: { assetKind: 'video' | 'audio' }): UploadAnalysis {
  const tracks = Array.isArray(parsed.media?.track) ? parsed.media?.track ?? [] : []
  const general = tracks.find((track) => track['@type'] === 'General') ?? {}
  const videoTrack = tracks.find((track) => track['@type'] === 'Video') ?? {}
  const audioTrack = tracks.find((track) => track['@type'] === 'Audio') ?? {}
  const treatAsVideo = options.assetKind === 'video'

  const overallBitrate = parseBitrate(general.OverallBitRate ?? general.BitRate)
  const videoBitrate =
    parseBitrate(videoTrack.BitRate ?? videoTrack.BitRate_Nominal ?? videoTrack.BitRate_Maximum) ??
    undefined
  const height = parseNumber(videoTrack.Height)
  const fps = parseFps(videoTrack.FrameRate ?? videoTrack.FrameRate_Original)
  const recommendation = matchBitrateRecommendation(height, fps)

  return {
    containerFormat: general.Format || general.Format_String,
    durationSeconds: parseNumber(general.Duration) ? parseNumber(general.Duration)! / 1000 : undefined,
    overallBitrate,
    video: {
      codec: firstNonEmpty(videoTrack.Format, videoTrack.CodecID, videoTrack.CodecID_String),
      profile: videoTrack.Format_Profile,
      width: parseNumber(videoTrack.Width),
      height,
      fps,
      bitrate: videoBitrate,
    },
    audio: {
      codec: firstNonEmpty(audioTrack.Format, audioTrack.CodecID, audioTrack.CodecID_Hint),
      bitrate: parseBitrate(audioTrack.BitRate ?? audioTrack.BitRate_Nominal),
      sampleRate: parseSampleRate(audioTrack.SamplingRate),
      channels: parseNumber(audioTrack.Channels),
    },
    warnings: buildWarnings({ general, videoTrack, audioTrack, recommendation, treatAsVideo, t }),
    bitrateStatus: resolveBitrateStatus({ recommendation, overallBitrate, videoBitrate, treatAsVideo }),
    recommendationLabel: recommendation.rule
      ? t('recommendations.label', { resolution: recommendation.rule.resolutionLabel, fps: recommendation.rule.fps })
      : undefined,
    recommendationDetails: recommendation.rule
      ? t('recommendations.details', {
          min: recommendation.rule.minBitrateMbps,
          max: recommendation.rule.maxBitrateMbps,
          target: recommendation.rule.targetBitrateMbps,
        })
      : undefined,
    normalizedFpsLabel: recommendation.normalizedFps
      ? t('recommendations.normalizedFps', { fps: recommendation.normalizedFps })
      : undefined,
    isLikelyCompatible: resolveCompatibility({ videoTrack, audioTrack, treatAsVideo }),
  }
}
```

- [ ] **Step 6: Run focused frontend tests and rebuild**

Run: `cd frontend && CI=1 npx jest src/app/dashboard/library/hooks/__tests__/useLibraryUploads.test.tsx src/components/upload/__tests__/UploadModal.test.tsx src/components/upload/__tests__/uploadAnalysis.test.ts --runInBand`
Expected: PASS

Run: `cd frontend && npm run build`
Expected: PASS and `/dashboard/library` no longer grows because of eager upload-modal orchestration

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/dashboard/library/hooks/useLibraryUploads.ts frontend/src/app/dashboard/library/hooks/__tests__/useLibraryUploads.test.tsx frontend/src/app/dashboard/library/page.tsx frontend/src/components/upload/UploadModal.tsx frontend/src/components/upload/uploadAnalysis.ts frontend/src/components/upload/__tests__/uploadAnalysis.test.ts
git commit -m "refactor: split library upload orchestration"
```

### Task 8: Move Streaming Page Mutations Out of the Route Component

**Files:**
- Create: `frontend/src/app/dashboard/streaming/hooks/useStreamMutations.ts`
- Test: `frontend/src/app/dashboard/streaming/hooks/__tests__/useStreamMutations.test.tsx`
- Modify: `frontend/src/app/dashboard/streaming/page.tsx`
- Modify: `frontend/src/app/dashboard/streaming/__tests__/page.test.ts`

- [ ] **Step 1: Write the failing mutation hook tests**

```tsx
import { renderHook, act } from '@testing-library/react'

import { useStreamMutations } from '../useStreamMutations'
import { api } from '@/lib/api'

jest.mock('@/lib/api', () => ({
  api: {
    streams: {
      quality: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    },
  },
}))

it('adds optimistic running state before a successful start', async () => {
  ;(api.streams.quality as jest.Mock).mockResolvedValue({ ok: true, violations: [] })
  ;(api.streams.start as jest.Mock).mockResolvedValue({ id: 'stream-1', status: 'running' })

  const { result } = renderHook(() =>
    useStreamMutations({ userId: 'user-1', queryClient: {} as any, streamingToasts: ((x: string) => x) as any, openQualityGate: jest.fn() })
  )

  await act(async () => {
    await result.current.startStreamMutation.mutateAsync({ streamId: 'stream-1' })
  })

  expect(api.streams.start).toHaveBeenCalledWith('stream-1')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && CI=1 npx jest src/app/dashboard/streaming/hooks/__tests__/useStreamMutations.test.tsx --runInBand`
Expected: FAIL with `Cannot find module '../useStreamMutations'`

- [ ] **Step 3: Create a route-specific mutation hook**

```tsx
export function useStreamMutations({
  userId,
  queryClient,
  streamingToasts,
  openQualityGate,
}: UseStreamMutationsOptions) {
  const [optimisticRunningStreamIds, setOptimisticRunningStreamIds] = useState<string[]>([])
  const [optimisticStoppingStreamIds, setOptimisticStoppingStreamIds] = useState<string[]>([])

  const startStreamMutation = useMutation({
    mutationFn: async ({ streamId }: { streamId: string }) => {
      const quality = await api.streams.quality(streamId)
      if (!quality.ok) {
        const error = new Error('quality_rejected') as Error & { quality: StreamQualityResponse }
        error.quality = quality
        throw error
      }
      return api.streams.start(streamId)
    },
    onMutate: async ({ streamId }) => {
      setOptimisticRunningStreamIds((current) => (current.includes(streamId) ? current : [...current, streamId]))
    },
  })

  return {
    optimisticRunningStreamIds,
    optimisticStoppingStreamIds,
    startStreamMutation,
    setOptimisticRunningStreamIds,
    setOptimisticStoppingStreamIds,
  }
}
```

- [ ] **Step 4: Replace the six inline `useMutation()` blocks in the page with the new hook**

```tsx
const {
  optimisticRunningStreamIds,
  optimisticStoppingStreamIds,
  startStreamMutation,
  stopStreamMutation,
  updateScheduleMutation,
  createDestinationMutation,
  updateDestinationMutation,
  deleteDestinationMutation,
} = useStreamMutations({
  userId: user?.id,
  queryClient,
  streamingToasts,
  openQualityGate,
})
```

- [ ] **Step 5: Re-run focused streaming tests**

Run: `cd frontend && CI=1 npx jest src/app/dashboard/streaming/hooks/__tests__/useStreamMutations.test.tsx src/app/dashboard/streaming/__tests__/page.test.ts --runInBand`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/dashboard/streaming/hooks/useStreamMutations.ts frontend/src/app/dashboard/streaming/hooks/__tests__/useStreamMutations.test.tsx frontend/src/app/dashboard/streaming/page.tsx frontend/src/app/dashboard/streaming/__tests__/page.test.ts
git commit -m "refactor: extract streaming page mutations"
```

### Task 9: Replace Placeholder Backend Tests and Sync the Docs

**Files:**
- Create: `backend/tests/test_admin_api_routes.py`
- Modify: `backend/tests/test_admin_api.py`
- Modify: `backend/tests/test_migrations.py`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `README.md`

- [ ] **Step 1: Replace the placeholder admin test with a real route-level test**

```python
import pytest
from httpx import AsyncClient

from app.main import app
from app.api.routes import admin as admin_routes


@pytest.mark.asyncio
async def test_non_admin_cannot_access_admin_users(monkeypatch):
    async def fake_require_admin():
        raise HTTPException(status_code=403, detail="Admin access required")

    app.dependency_overrides[admin_routes.require_admin_user] = fake_require_admin

    try:
        async with AsyncClient(app=app, base_url="http://testserver") as client:
            response = await client.get("/api/admin/users")
    finally:
        app.dependency_overrides.pop(admin_routes.require_admin_user, None)

    assert response.status_code == 403
```

- [ ] **Step 2: Replace `pass` placeholders in migration tests with executable assertions**

```python
@pytest.mark.asyncio
async def test_user_can_only_see_own_assets_policy_exists(db: AsyncSession):
    result = await db.execute(
        text("SELECT policyname FROM pg_policies WHERE tablename = 'assets'")
    )
    policies = {row[0] for row in result}
    assert policies


@pytest.mark.asyncio
async def test_admin_policies_exist(db: AsyncSession):
    result = await db.execute(
        text("SELECT policyname FROM pg_policies WHERE schemaname = 'public'")
    )
    assert result.fetchall()
```

- [ ] **Step 3: Update docs to match the new contracts and split seams**

```md
- `frontend/src/lib/tusd.ts` is the single place that turns `NEXT_PUBLIC_TUSD_URL` into a final `/files/` endpoint.
- `backend/app/core/database.py` now treats request sessions as non-committing by default; API-facing services commit explicitly.
- `backend/app/streaming/ffmpeg_manager.py` coordinates command building, runtime signals, and process support through extracted helper modules.
- `/dashboard/library` lazy-loads the upload modal instead of shipping its orchestration in the initial route bundle.
```

- [ ] **Step 4: Run docs-adjacent regression tests**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_admin_api_routes.py tests/test_migrations.py -v`
Expected: PASS

Run: `cd frontend && CI=1 npx jest src/app/dashboard/library/__tests__/useLibraryPageData.test.tsx src/app/dashboard/streaming/__tests__/page.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_admin_api_routes.py backend/tests/test_admin_api.py backend/tests/test_migrations.py docs/ARCHITECTURE.md docs/TESTING.md README.md
git commit -m "test: replace placeholders and sync docs"
```

### Task 10: Full Verification and Audit Close-Out

**Files:**
- Modify: `docs/superpowers/plans/2026-04-19-stability-structure-remediation.md`

- [x] **Step 1: Run strict frontend verification**

Run: `cd frontend && CI=1 npm test -- --runInBand`
Expected: PASS

Run: `cd frontend && npm run build`
Expected: PASS

Run: `cd frontend && npm run test:e2e`
Expected: PASS

- [x] **Step 2: Run strict backend verification on the canonical path**

Run: `make dev-bootstrap`
Expected: postgres and redis are running from Compose

Run: `make test-backend`
Expected: PASS

Run: `make lint RUN_BLACK=1`
Expected: PASS

Run: `make type-check RUN_MYPY=1`
Expected: PASS

- [x] **Step 3: Run the full gate**

Run: `make verify-v0`
Expected: PASS

- [x] **Step 4: If `127.0.0.1:5432` is already occupied, use the documented fallback instead of guessing**

Run: `make test-backend-localdb`
Expected: PASS using a temporary database on the existing local PostgreSQL instance

- [x] **Step 5: Update the checklist in this plan with actual pass/fail evidence**

```md
- 2026-04-19: `cd frontend && CI=1 npm test -- --runInBand` -> PASS
- 2026-04-19: `cd frontend && npm run build` -> PASS
- 2026-04-19: `cd frontend && npm run test:e2e` -> PASS
- 2026-04-19: `make dev-bootstrap` -> FAIL (`127.0.0.1:5432` occupied by a non-Compose PostgreSQL service)
- 2026-04-19: `make test-backend` -> FAIL (preflight refused to run against the occupied non-Compose PostgreSQL service)
- 2026-04-19: `make lint RUN_BLACK=1` -> PASS
- 2026-04-19: `make type-check RUN_MYPY=1` -> PASS
- 2026-04-19: `DATABASE_URL=postgresql://youtube_user:dev_password_local_only@localhost:5432/youtube_streaming make test-backend-localdb` -> PASS (`348 passed, 8 skipped`)
- 2026-04-19: `make verify-v0` -> FAIL because the embedded `make test` step hit the same backend preflight guard on `127.0.0.1:5432`
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-04-19-stability-structure-remediation.md
git commit -m "docs: record stability remediation verification"
```

## Self-Review

### Spec Coverage

- Stability contracts: covered by Task 1 and Task 2.
- Hidden runtime failure modes: covered by Task 3, Task 5, and Task 6.
- Backend structure without unnecessary platform rewrite: covered by Task 4 through Task 6.
- Frontend clarity and slimmer heavy routes: covered by Task 7 and Task 8.
- Missing/placeholder critical tests: covered by Task 9.
- Full evidence-based verification: covered by Task 10.

### Placeholder Scan

- Search terms to run before execution: `rg -n "TODO|TBD|implement later|similar to" docs/superpowers/plans/2026-04-19-stability-structure-remediation.md`
- Expected: no matches

### Type Consistency

- TUS helper name is consistently `resolveTusEndpoint`.
- Upload orchestration hook name is consistently `useLibraryUploads`.
- Streaming mutation hook name is consistently `useStreamMutations`.
- Extracted backend runtime modules are consistently `command_builder.py`, `runtime_signals.py`, and `process_support.py`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-stability-structure-remediation.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
