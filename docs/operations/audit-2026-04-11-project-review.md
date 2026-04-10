# Project Audit - 2026-04-11

Repository: `~/Documents/Work/youtube_translation`
Scope: whole-project audit with emphasis on stream stability, upload reliability, runtime restart behavior, dashboard/operator UX, and alignment with official YouTube, FFmpeg, and tus documentation.
Result: `REQUEST CHANGES`

## Executive Summary

The project is in a generally solid state: lint, type-check, i18n checks, frontend tests, and several critical backend stream/upload suites pass locally. I did not find a critical security failure in the reviewed paths.

The main production concern is stream resilience under transient ingest/network failures. The current FFmpeg recovery configuration is real, but too narrowly budgeted. There are also visibility and operator-control gaps that can make incidents harder to detect and recover from.

## Findings

### HIGH

1. FFmpeg recovery budget is hard-capped low enough to terminate otherwise recoverable streams

Files:
- `backend/app/streaming/ffmpeg_manager.py:112`
- `backend/app/streaming/ffmpeg_manager.py:820`

Evidence:
- `_build_tee_destination(...)` sets `attempt_recovery=1`, `recover_any_error=1`, `restart_with_keyframe=1`, and `max_recovery_attempts=3`.
- The single-destination output path mirrors the same limit with `-max_recovery_attempts 3`.

Risk:
- A short series of transient upstream RTMP(S) failures can permanently terminate the FFmpeg publishing leg instead of self-healing.
- This is the most important stream-stability issue found in the repository.

Why this matters against docs:
- FFmpeg explicitly documents fifo-based recovery for temporary output failures. The implementation uses the right mechanism, but the current cap is small for real-world ingest turbulence.

Recommendation:
- Treat recovery policy as an operationally tuned setting instead of a hardcoded tiny cap.
- Re-verify behavior against representative packet loss / remote reset scenarios.

### MEDIUM

2. YouTube provider status ignores upstream health/configuration issues that the API already exposes

Files:
- `backend/app/services/youtube/client.py:99`
- `backend/app/services/youtube/provider_status.py:98`

Evidence:
- The provider flow checks only active broadcast presence and `liveStreamingDetails.concurrentViewers`.
- It does not fetch or surface `liveStreams.status.streamStatus`, `liveStreams.status.healthStatus.status`, or `configurationIssues[]`.

Risk:
- The app can present a stream as simply `live` while YouTube is already marking ingest quality or configuration as degraded.
- Operators lose early warning for issues such as missing audio, invalid GOP/keyframe cadence, low bitrate, or other documented ingest problems.

Recommendation:
- Extend provider-status polling to include `liveStreams` health fields and preserve those signals in API/UI state.

3. Dashboard stop control is misleading during incidents

File:
- `frontend/src/app/dashboard/page.tsx:208`

Evidence:
- The `■ Зупинити` button only calls `router.push('/dashboard/streaming')`.
- It does not trigger a stop mutation or `api.streams.stop(...)`.

Risk:
- An operator can believe they stopped an active stream when they only navigated to another page.
- This is especially risky under time pressure.

Recommendation:
- Either wire the button to a real stop action with confirmation/error handling, or relabel it so it does not imply control of the stream lifecycle.

4. Auto-restart defaults and reported runtime state diverge

Files:
- `backend/app/core/config.py:112`
- `backend/app/core/stream_runtime_restart.py:144`
- `backend/app/schemas/api.py:501`
- `backend/.env.example:94`
- `docs/operations/supervisor.md:52`

Evidence:
- Code defaults to `stream_runtime_auto_restart_enabled=true` with `stream_runtime_restart_max_attempts=0`.
- Runtime scheduling exits early when `max_attempts < 1`.
- API restart-state shaping still derives `enabled` from the boolean feature flag first.
- The example env and supervisor docs recommend nonzero restart attempts.

Risk:
- Default deployments may appear restart-capable while the scheduler is effectively disabled.
- This creates confusing observability during failures and weakens the expected safety net.

Recommendation:
- Align defaults, runtime behavior, and exposed API state so "enabled" means restart is actually schedulable.

### LOW

5. Architecture docs still describe SSE while the implementation is WebSocket-based

Files:
- `docs/ARCHITECTURE.md:76`
- `docs/ARCHITECTURE.md:119`
- `docs/ARCHITECTURE.md:239`
- `backend/app/api/routes/streams.py:85`
- `frontend/src/app/dashboard/streaming/hooks/useStreamSocket.ts:9`

Risk:
- This mainly hurts debugging, onboarding, and incident response.

Recommendation:
- Update the architecture documentation to consistently describe WebSocket transport.

6. Dashboard page coverage is shallow around incident-control behavior

File:
- `frontend/src/app/dashboard/__tests__/page.test.tsx:1`

Evidence:
- The current dashboard page test verifies rendering/basic loading only.
- There is no targeted assertion that the stop control triggers a real stop action.

Risk:
- Regressions in operator controls can ship unnoticed.

Recommendation:
- Add a focused test for active-stream controls on the dashboard.

## What Looks Good

- tus upload flow appears aligned with the tus 1.0 protocol in the reviewed paths.
- `backend/tusd-hooks/post-finish` is defensive and idempotent.
- Stream runtime/restart logic has dedicated backend coverage.
- WebSocket stream update handling has targeted frontend and backend tests.

## Verification Performed

Passed:
- `make lint RUN_BLACK=1`
- `make type-check RUN_MYPY=1`
- `make i18n-check`
- `cd frontend && CI=1 npm test`
- `backend/.venv/bin/python -m pytest backend/tests/test_youtube_provider_status.py -q`
- `backend/.venv/bin/python -m pytest backend/tests/test_ffmpeg_manager.py -q`
- `backend/.venv/bin/python -m pytest backend/tests/test_upload_finalization.py -q`
- `backend/.venv/bin/python -m pytest backend/tests/test_stream_runtime_restart.py -q`
- `cd frontend && CI=1 npm test -- --runTestsByPath src/app/dashboard/__tests__/page.test.tsx src/app/dashboard/streaming/hooks/__tests__/useStreamSocket.test.tsx`
- `POSTGRES_PASSWORD=... docker compose -f docker/docker-compose.yml config`

Blocked:
- Full Docker-backed backend suite could not be completed because the local Docker daemon was unavailable during this audit run.

## Primary Documentation Used

- YouTube RTMPS ingestion guide: <https://developers.google.com/youtube/v3/live/guides/rtmps-ingestion>
- YouTube `liveStreams` reference: <https://developers.google.com/youtube/v3/live/docs/liveStreams>
- YouTube health status messages: <https://developers.google.com/youtube/v3/live/docs/liveStreams/health_status_messages>
- YouTube encoder settings: <https://support.google.com/youtube/answer/2853702>
- tus resumable upload protocol 1.0: <https://tus.io/protocols/resumable-upload>
- FFmpeg main docs: <https://ffmpeg.org/ffmpeg.html>
- FFmpeg protocol docs: <https://ffmpeg.org/ffmpeg-protocols.html>

## Suggested Fix Order

1. Raise or externalize FFmpeg recovery budgets and validate with fault-injection style tests.
2. Surface YouTube stream health/configuration issues in provider status and UI.
3. Fix or relabel the dashboard stop control.
4. Align auto-restart defaults with actual runtime behavior and API semantics.
5. Refresh architecture docs and add targeted dashboard control coverage.
