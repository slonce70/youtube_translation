## 2026-04-25
- Audit/cleanup pass:
  - оновлено frontend dependency audit: `postcss` вирівняно до `8.5.10` через npm override, `npm audit --omit=dev` повернувся до green state
  - актуалізовано `make security-audit`, `README.md`, `docs/TESTING.md`, MediaMTX/MVP docs і `requirements.md` під реальний runtime/service baseline без Compose `runner`
  - додано `docs/audit/2026-04-25_project_uix_code_audit.md` з UIX, dependency, documentation і code-structure висновками
  - локалізовано landing mobile navigation aria-label і прибрано прямі WebSocket `console.*` з dashboard streaming hook

## 2026-03-21
- Docs: додано `docs/YOUTUBE_NEXT_WAVE_TECH_DESIGN.md` з техдизайном для YouTube OAuth/API, lifecycle broadcast/stream, VOD segmentation та live controls; додано офіційні посилання на OAuth, YouTube Data API, Live Streaming API та quota docs.

## 2026-03-29
- QA: оновлено `docs/TESTING.md` з першим QA baseline для `youtube_translation`: regression matrix, merge/release gate, результати фактичного прогону `lint` / `type-check` / `i18n` / unit / e2e та поточні release blockers у assets/media-collections і library upload flow.

## 2026-04-11
- Stream resilience hardening, tranche 1:
  - додано degraded-live detection для repeated remote output reset / recovery storm / Non-monotonic DTS і durable `stream_events` + `system_alerts`
  - frontend тепер показує `running + degraded` через incident summary у dashboard/streaming
  - `/api/metrics` capacity позначено як heuristic, не authoritative production limit
  - додано fail-closed guard для `containerized backend + STREAM_RUNTIME_MODE=systemd` у `staging`/`production`
  - підготовлено host-native Linux control-plane artifacts: `youtube-backend.service.example`, `streaming.slice.example`, hardened `ffmpeg@.service.example`
  - додано repo-native helpers: `scripts/install_systemd_runtime.sh`, `scripts/cutover_host_runtime.sh`, `scripts/rollback_host_runtime.sh`, `scripts/runtime_guards.sh`
  - loopback-публікація `postgres`/`redis` у compose тепер дозволяє host-native backend control plane без Docker-to-host `systemctl` hacks
  - додано shell-level regression tests для installer / cutover / rollback / runtime guards
