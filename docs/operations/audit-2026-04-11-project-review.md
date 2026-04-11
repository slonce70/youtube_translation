# Project Audit - 2026-04-11

Repository: `~/Documents/Work/youtube_translation`
Scope: whole-project and live-VPS audit with emphasis on stream resilience, multi-stream isolation, runner/runtime failure modes, operator visibility, and whether one stream or service failure can cascade into others.
Result: `REQUEST CHANGES`

## Executive Summary

The project is materially stronger than in the previous audit pass. Several earlier concerns are now genuinely fixed in code:

- FFmpeg output recovery is no longer capped to a tiny retry budget.
- YouTube provider status already pulls `liveStreams.status.healthStatus` and `configurationIssues[]`.
- The dashboard stop button now issues a real stop mutation and has a focused test.

The main remaining production risk is not a single bad line of code. It is the current tranche-one deployment model:

- all live FFmpeg workers still share one `runner` container on one VPS,
- that container has no CPU, memory, or PID isolation,
- degraded RTMPS transport behavior is visible in raw stream logs but is not elevated into operator-facing alerts while the stream keeps limping along,
- MediaMTX is deployed but not actually in the publish path, so it is not helping with isolation or buffering.

The current system already proves one useful property: an individual FFmpeg process can hit repeated YouTube-side `Broken pipe` / `Connection reset by peer` failures without immediately killing a sibling stream. But the broader shared-fate problem is still real: one overloaded `runner`, host issue, Docker issue, disk issue, or manual restart still has the power to impact all streams at once.

## Implementation Progress Since This Audit

The repository has already moved on several recommendations from this audit:

- degraded-live runtime signals are now promoted into durable `stream_events` / `system_alerts` and surfaced in frontend operator state instead of living only in raw logs
- `/api/metrics` capacity is now documented as heuristic, not authoritative production capacity
- `containerized backend + STREAM_RUNTIME_MODE=systemd` is now fail-closed blocked in `staging`/`production` without explicit override
- the repo now contains host-native Linux control-plane artifacts (`youtube-backend.service.example`, `streaming.slice.example`) plus repo-native installer/cutover/rollback helpers for future canary rollout

Remaining top risks from this audit still apply until an actual host-native backend + per-stream `systemd` canary cutover is completed on the VPS.

## Live VPS Verification

Verification window: 2026-04-11, approximately 10:06-10:16 Europe/Kiev (`07:06-07:16 UTC`)

Host facts gathered read-only from `root@203.0.113.10`:

- Containers up: `youtube-streaming-backend`, `youtube-streaming-runner`, `youtube-streaming-frontend`, `youtube-streaming-postgres`, `youtube-streaming-tusd`, `youtube-streaming-redis`, `youtube-streaming-mediamtx`
- Container restart counts: all `0`
- OOM kills observed: none
- Host shape: `4` vCPU, `7.6 GiB` RAM, `0` swap
- Disk use on `/`: `61%`
- Active live streams in DB: `2`
- Active supervisor programs in runner: `2`

Observed runtime state:

- `supervisorctl` showed:
  - `stream_3b5c06fd-f9f8-4acb-bae5-8db41f4d6dc1 RUNNING`
  - `stream_9351356c-ac19-4f49-ada9-ce9feed946ce RUNNING`
- DB lease ownership and heartbeat timestamps were moving forward over time for both streams.
- Shared heartbeat files under `/opt/youtube_translation_data/streams/.runtime-heartbeats/` matched the DB lease owner `your-server`.

Observed resource usage:

- sample 1: `runner 102.14% CPU / 1.325 GiB`, `backend 0.21% CPU`, `frontend 0.00% CPU`
- sample 2: `runner 38.92% CPU / 1.306 GiB`, `backend 0.33% CPU`, `frontend 0.00% CPU`
- sample 3: `runner 38.98% CPU / 1.306 GiB`, `backend 0.23% CPU`, `frontend 0.00% CPU`

Observed stream-specific symptoms:

- stream `3b5c06fd-...` had repeated:
  - `IO error: Broken pipe`
  - `IO error: Connection reset by peer`
  - `Recovery successful`
- stream `9351356c-...` had repeated:
  - `Non-monotonic DTS`

Observed visibility gaps:

- `system_alerts` rows on VPS: `0`
- `stream_events` rows on VPS: `16`
- the stored `stream_events` were stop-oriented audit events, not degraded-live transport warnings
- backend logs showed MediaMTX polling (`GET /v3/paths/list`, `GET /metrics`) and authenticated WebSocket usage, but MediaMTX itself reported `path_count = 0`

## Findings

### HIGH

1. Shared `runner` topology still creates a single blast radius for all live streams

Files:

- `docker/docker-compose.yml:174`
- `docs/ARCHITECTURE.md:123`
- `docs/ARCHITECTURE.md:266`
- `docs/operations/supervisor.md:22`

Evidence:

- All FFmpeg workers still run inside one `youtube-streaming-runner` container.
- The architecture docs explicitly describe the supported tranche-one topology as one all-in-one node.
- Live VPS verification showed two concurrent streams under one supervisor instance on one host.

Risk:

- A `runner` crash, Docker daemon issue, host reboot, disk failure, or operator restart still threatens all streams together.
- This is the biggest remaining gap against the requirement that one stream or service failure should not take down the others.

Recommendation:

- Treat current deployment as “process-isolated, host-shared”, not “stream-isolated”.
- Do not market or rely on full stream isolation until worker placement is separated from single-container single-host failure domains.

2. The shared `runner` has no container-level resource guardrails, so one pathological stream can degrade siblings

Files:

- `docker/docker-compose.yml:174`
- `backend/scripts/start-runner.sh:1`

Evidence:

- `docker inspect youtube-streaming-runner` on VPS returned:
  - `cpus=0`
  - `mem=0`
  - `pids=<no value>`
- Live samples showed the shared runner using up to `102.14%` CPU and about `1.3 GiB` RAM with only two active streams.
- Each stream is only supervisor-isolated inside the same container; there is no container/runtime quota wall between them.

Risk:

- A single high-bitrate or malformed stream can starve the shared runner and indirectly degrade other streams even if the sibling FFmpeg process itself is “correct”.
- The risk rises sharply with 4K inputs, timestamp anomalies, reconnect storms, or future mixed/transcode paths.

Recommendation:

- Add resource isolation before promising stable many-user concurrency.
- At minimum, make capacity claims reflect real measured runner cost rather than idealized copy-only assumptions.

3. Degraded-but-still-running transport failures are not surfaced as operator alerts

Files:

- `backend/app/streaming/ffmpeg_manager.py:1383`
- `backend/app/services/streams/control.py:851`
- `frontend/src/lib/stream-state.ts:98`
- `frontend/src/app/dashboard/streaming/page.tsx:585`

Evidence:

- Restart warning alerts are created only on FFmpeg exit/restart paths.
- The logs API reads the tail of the file and optionally filters “important” lines, but it does not persist degraded-live incidents as alerts.
- `deriveStreamState(...)` marks attention from restart/quota/provider health, not from repeated FFmpeg transport fault patterns.
- Live VPS evidence showed dozens of `Broken pipe` / `Connection reset by peer` / `Recovery successful` lines on a running stream while:
  - `system_alerts = 0`
  - `stream_events` contained no degraded-live fault trail

Risk:

- Operators can miss a stream that is repeatedly dropping and recovering until it finally fails hard.
- This weakens incident detection and can let one unstable stream burn runner resources for a long time without escalating.

Recommendation:

- Promote repeated remote output resets and repeated recovery cycles into stream-level degraded state and alerting.
- Track “recovery storm” patterns, not only terminal exits.

### MEDIUM

4. MediaMTX is deployed and polled, but it is not in the publish path and currently provides no isolation benefit

Files:

- `docker/docker-compose.yml:216`
- `backend/app/core/mediamtx.py:119`
- `docs/operations/mediamtx.md:64`

Evidence:

- Live backend logs showed successful polling of MediaMTX control and metrics endpoints.
- Live `fetch_mediamtx_summary()` output showed `reachable=true` but `path_count=0` and empty `active_paths`.
- The docs explicitly state that backend does not route streams through MediaMTX automatically yet.
- Active FFmpeg commands on the VPS were publishing directly to `rtmps://a.rtmp.youtube.com/live2/...`.

Risk:

- MediaMTX currently improves observability readiness, but not stream isolation, buffering, or publish-path fault containment.
- Its presence can be misread as an active media-plane safeguard when it is not.

Recommendation:

- Either route publish traffic through the media plane intentionally, or describe it very clearly as inactive-for-publish in production runbooks.

5. Durable managed restarts still depend on the backend control loop being alive

Files:

- `backend/app/main.py:221`
- `backend/app/core/stream_reconciler.py:517`
- `backend/app/streaming/ffmpeg_manager.py:1160`

Evidence:

- Persistent retry dispatch is driven by `periodic_stream_status_sync()` in the backend process every 10 seconds.
- The runner process itself provides one local FFmpeg retry path (`FFMPEG_AUTO_RESTART_ATTEMPTS=1` on the live VPS), but durable DB-backed retry orchestration is backend-owned.

Risk:

- A backend outage will not kill already-running streams, which is good.
- But if a stream fails during a backend outage, recovery beyond the local FFmpeg retry budget waits for backend recovery.

Recommendation:

- Document this boundary explicitly in the ops runbook.
- Keep backend recovery fast, because it is part of the restart control plane even when media execution is offloaded to `runner`.

### LOW

6. The current `/api/metrics` capacity model is too optimistic for real production stream cost

Files:

- `backend/app/api/routes/metrics.py:162`

Evidence:

- Capacity estimation assumes about `3.5%` CPU and `75 MB` RAM per stream.
- Live VPS evidence showed one 4K stream alone consuming far more than that estimate.

Risk:

- If this estimate is used for operational decisions later, it can overstate safe concurrency.

Recommendation:

- Recalibrate estimates from live workload classes or label the result as a lightweight heuristic only.

## Already Fixed Since Earlier Audit

These previously reported issues appear fixed in the current repository:

1. FFmpeg output recovery budget is no longer hard-capped low

- `backend/app/core/config.py:78` now defaults `ffmpeg_output_recovery_max_attempts` to `0`
- `backend/app/streaming/ffmpeg_manager.py:112`
- `backend/app/streaming/ffmpeg_manager.py:821`

2. YouTube provider health/configuration issues are already surfaced

- `backend/app/services/youtube/client.py:128`
- `backend/app/services/youtube/provider_status.py:128`

3. Dashboard stop control now performs a real stop mutation

- `frontend/src/app/dashboard/page.tsx:226`
- `frontend/src/app/dashboard/__tests__/page.test.tsx:128`

## What Looks Good

- FFmpeg output recovery is configured in the right direction for transient RTMPS failures.
- Running streams survive backend restarts conceptually because execution is separated into the runner.
- Heartbeat + DB lease ownership are alive and coherent on the VPS.
- The stop flow is audited and leaves a durable operator trail.
- Provider health information is now modeled end-to-end in code.
- `/api/metrics/` is admin-protected; unauthenticated probing returned `401` on the live VPS.

## Verification Performed

Repository verification:

- `make lint RUN_BLACK=1`
- `make type-check RUN_MYPY=1`
- `backend/.venv/bin/python -m pytest backend/tests/test_ffmpeg_manager.py backend/tests/test_stream_runtime_restart.py backend/tests/test_youtube_provider_status.py backend/tests/test_stream_runtime_config.py -q`
- `cd frontend && CI=1 npm test -- --runTestsByPath src/app/dashboard/__tests__/page.test.tsx src/app/dashboard/streaming/__tests__/log-audit.test.ts src/lib/__tests__/stream-state.test.ts src/lib/__tests__/provider-status.test.ts`

Live VPS verification:

- `docker ps`
- `docker inspect` for restart/OOM/health
- `docker stats --no-stream` sampled repeatedly
- `supervisorctl status`
- Postgres queries for stream status, lease ownership, heartbeat timestamps, stream events, and alerts
- direct inspection of heartbeat JSON files
- direct inspection of per-stream `stream.log`
- backend log inspection for WebSocket, MediaMTX polling, and `/api/metrics/` auth behavior

Not performed:

- no destructive tests on the VPS
- no forced stream crashes
- no service restarts during live traffic

## Suggested Fix Order

1. Reduce shared-fate risk around the `runner` execution plane.
2. Surface degraded-live transport failures as alerts before terminal failure.
3. Add real resource guardrails for runner workloads.
4. Decide whether MediaMTX is production-observability only or part of the actual publish topology.
5. Recalibrate or clearly de-scope capacity estimation logic.
