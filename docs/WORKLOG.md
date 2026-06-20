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

## 2026-06-20
- **SIGNAL design-language redesign** (operator console + landing brand cohesion). Canonical reference: `docs/design/SIGNAL_REDESIGN_PLAN.md` (produced by a multi-agent competitive-benchmark + design workflow).
  - Unified the three fragmented visual languages into one token system: cool-gray neutral spine + single electric-indigo accent (`#5B6CFF`), semantic-only chroma (green=live / amber=warn / red=error). Retinted `.dashboard-v2` vars, base `:root`/`.dark`, `tailwind.config.js` (purple→indigo, cyan→blue), landing `--lpc-accent`, and the Three.js hero globe.
  - Brand unification: dashboard now uses the `Loopcast` mark + wordmark (new `components/ui/Logo.tsx`); `nav.brand.name` set to Loopcast across locales.
  - Removed all decorative emoji-as-icons: stripped baked-in emoji from i18n labels (streaming/library/dashboard/profile) and replaced component emoji (📡🎬🎵📋⬆️🎮▶🗑 …) with consistent `lucide-react` icons across streaming, library/AssetCard, channels, profile, and the stream-builder/add-channel modals. Preserved language flags, the greeting 👋, and ✓/✗ status glyphs.
  - Flattened gimmicky primitives (dropped `hover:scale-105` / `shadow-glow` / gradient buttons); refined sidebar active state and stat strip.
  - Accessibility baseline: app-wide `:focus-visible` rings, universal `prefers-reduced-motion`, and a skip-to-content link (`nav.skipToContent`).
  - Resilience: every API request is now bounded by a 15s `AbortController` timeout, wrapping timeouts (408) and network errors (0) as `ApiError` so dashboards surface a recoverable error instead of an indefinite loading spinner.
  - Repo hygiene: merged all work to `main`; deleted stale local + remote work branches (kept `main` + bot-managed dependabot branches).
  - Gates green: `lint`, `i18n:check`, `jest` (175), `next build`.
