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
- **SIGNAL redesign — adversarial review + deferred-work execution.** Ran an 80-agent multi-dimension review workflow (design/a11y/bugs/dead-code/i18n/responsive/structure/competitive); 58 findings adversarially confirmed → `docs/design/SIGNAL_REVIEW_BACKLOG.md`. Then executed the verifiable backlog:
  - Closed remaining palette leaks (gradient-text, go-live glow, logo/focus/cmd glows, serif console numerals) + deleted dead CSS (`animated-gradient`, `--violet`, duplicate `.badge-error`, unused badge/btn variants).
  - i18n: fixed `MISSING_MESSAGE` on the channels health badge, localized stream-source labels + start toast + aria-labels, deleted dead `dashboard.home`, swapped emoji platform icons for lucide.
  - a11y: `role=status`/`aria-live` on stream health, `MotionConfig reducedMotion=user`, real focus-trap in UploadModal, DropdownMenu menu semantics, tabpanel wiring; mobile grids collapse; `.btn-sm` 40px on coarse pointers. Fixed the 15s API timeout to also cover the body read.
  - Structure (#9): removed dead/superseded streaming components (StreamsList/StreamStatsCards/…), removed the duplicate legacy live card (kept `LiveStreamHero`), deleted ~2719 LOC of orphaned landing components + dead `stream-v3-*` CSS, decomposed StreamBuilderModal (507→350).
  - Competitive (#8): **F1** command-palette operator verbs (Start/Stop/Stop-all/Copy-link, scoped to live streams) and **F4** stream health spine + global warning chip.
  - Net since the redesign baseline: 71 files, +1870 / −5625 (≈ −3755 LOC). Gates: `lint`, `i18n:check`, `tsc`, `jest` (160), `next build`, `playwright` e2e (5/5) — all green.
  - Deferred (documented in the backlog): F2 schedule recurrence, F3 density toggle, R2 library extraction, R3 admin/users, R5 UploadModal, R6/R7 backend god-module splits.

## 2026-06-21
- **UX deep-audit + redesign directions** (external landing + operator panel). Canonical reference: `docs/design/UX_AUDIT_AND_REDESIGN_DIRECTIONS.md` (competitor teardown + premium-aesthetic playbook from a multi-agent research pass). Produced 5 landing + 5 dashboard visual prototypes for direction selection. Audit also surfaced real bugs to fix separately: `plans.json` dev-note leak (`releaseBadge`/`description`), duplicate "Поточний" badge, library storage counter, "RTMPS" jargon in the channels page title.
- **Redesign hybrid implemented (branch `redesign/control-room`):**
  - **Landing "Control Room" hero** — converted the centered-over-globe hero into a 2-column product-as-hero: copy left + a live operator console card right with a real-time ticking uptime, bitrate bars, viewers and now-playing. Dropped the Three.js `Hero3DGlobe` (landing First Load JS now ~121 kB) which also removed a dev scroll-lock. New `landing.loopcast.hero.console.*` i18n across uk/en/ru.
  - **Mission Control overview** — `/dashboard` is now the ops home (was a redirect): global health line + stream health tiles sorted most-broken-first (self-fetching status, 4-state health pill) + cross-stream events feed (`OverviewPage.tsx`). Re-added the "Дашборд" sidebar item. Enriched `dashboard.overview.*` i18n.
  - **Stream Cockpit controls** — the per-stream detail page (`/dashboard/streams/[id]`) already had Overview/Logs/Events; wired Stop/Restart into its `LiveStreamHero` (state-gated: Stop only when running), removed an unused `useRouter`.
  - Gates: `lint`, `type-check` (tsc), `i18n:check`, `jest` (160), `next build` — all green. Browser-verified landing (hero + scroll + features), overview, and cockpit.
