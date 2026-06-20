<!-- Generated 2026-06-20 by adversarial multi-agent review workflow (80 agents). Verified backlog. -->

All key findings confirmed against the live files. I have enough to produce the backlog.

# Loopcast SIGNAL Redesign — Execution Backlog

## 1. Executive Summary

The SIGNAL retint is **structurally landed but leaky**: the spine, accent tokens, lucide icons, and a11y scaffolding (focus-visible, skip-link, reduced-motion CSS) are in place, but the migration left a trail of off-palette stragglers (purple/cyan literals and gradients in the most operator-facing surfaces: `/login`, the Go-Live CTA, stat numerals, logo glow) and a large dead-code tail (~1100 lines of `stream-v3-*` CSS plus 10 orphaned landing components). The two highest-value *correctness* themes are **i18n leaks** (a MISSING_MESSAGE badge plus hardcoded Ukrainian strings shown to en/ru users) and **mobile responsiveness gaps** (non-wrapping rows, non-collapsing grids, sub-40px touch targets), with **a11y announcement gaps** (no live region for stream up/down, broken modal focus trap, JS-driven motion ignoring reduced-motion) close behind. The redesign is ~70% complete; the work below closes the leaks, deletes the dead weight, and adds the keyboard-first/operator differentiators the plan promises.

---

## 2. Fix Now — Prioritized Quick Wins (impact ÷ effort)

| # | Title | Area | Sev | File:line | Fix | Effort |
|---|-------|------|-----|-----------|-----|--------|
| 1 | `.gradient-text` still on purple+cyan ramp (login + 5 admin + StreamStatsCards) | design | med | `globals.css:1338-1341` | Replace `via-purple-500/400` middle stop with indigo, or flatten to `@apply bg-clip-text text-transparent` → solid `color:var(--indigo)`. Single edit fixes every consumer at once. | S |
| 2 | Channels page renders emoji platform icons via shared `platform.ts` | bug | low | `dashboard/streaming/platform.ts:32,41,49` → consumed `channels/page.tsx:239` | Return lucide components (`Youtube`/`Twitch`/`RadioTower`) instead of `'▶'/'🎮'/'📡'`, render component in `channels/page.tsx:239`, update `__tests__/platform.test.ts:13/27/41`. Matches StreamBuilderModal. | S |
| 3 | Channels provider-health badge throws MISSING_MESSAGE in all locales | i18n | med | `channels/page.tsx:65,204,206` | Keys resolve to non-existent `streaming.page.provider.healthIssues/.healthDegraded`. Add both keys under `page.provider` in en/ru/uk `streaming.json` (siblings `viewers`/`status.*` already live there). | S |
| 4 | Go-Live CTA glow uses oklch purple (hue 295) | design | low | `globals.css:2048,2058` | Swap `oklch(0.72 0.20 295 / 0.45)` and `/0.55` for `rgba(91,108,255,.45)` / `rgba(91,108,255,.55)` (the existing indigo glow token). | S |
| 5 | Console `--font-display` is serif; `.stat-value` renders 36px serif numerals | design | med | `globals.css:1584,2224` | Redefine `.dashboard-v2 --font-display` to `var(--font-tech), Inter, sans-serif` (or `var(--font-mono-app)` for numerals). Kills serif anywhere in console. | S |
| 6 | Stale purple/cyan hardcodes (logo glow + focus glows) | design | low | `globals.css:1678,1713,2188,2486` | Replace `rgba(109,93,252,*)` → `rgba(91,108,255,*)`; in 2486 also `rgba(56,189,248,.18)` → new cyan `rgba(88,166,255,.18)`. | S |
| 7 | Hardcoded Ukrainian fallback labels for stream source | i18n | med | `streaming/hooks/useStreamingPageData.ts:117-125` | `'Відеоряд'/'Плейлист'/'Черга (n)'/'Джерело не вказано'` shown to en/ru. Add `page.source.{videoSeries,playlist,queue,none}` to streaming.json (queue uses ICU `{count}`); pull via existing `tStreaming`. | M |
| 8 | Hardcoded Ukrainian optimistic toast | i18n | low | `streaming/hooks/useStreamMutations.ts:79` | Replace `toast.info('Запускаємо трансляцію...')` with `streamingToasts('stream.starting')`; add key to en/ru/uk. | S |
| 9 | Profile password form: hardcoded 3-col grid, never collapses | responsive | med | `dashboard/profile/page.tsx:367` | Replace inline `gridTemplateColumns:'repeat(3,minmax(0,1fr))'` with `grid grid-cols-1 sm:grid-cols-3 gap-4`. | S |
| 10 | Channel rows never stack on mobile (icon+URL+2 badges+2 btns overflow) | responsive | med | `globals.css:2722-2733` | Add `@media (max-width:640px){.dashboard-v2 .channel-row,.stream-row,.playlist-row,.asset-row{flex-wrap:wrap}}`. | S |
| 11 | Channel sub-text (RTMPS URL · key) no truncation | responsive | low | `channels/page.tsx:242-244` | Add `overflow:hidden;textOverflow:ellipsis;whiteSpace:nowrap` (or `wordBreak:'break-all'`) to the URL/key div. | S |
| 12 | Shared Modal has no max-height/scroll (tall AddChannelModal unreachable on phones) | responsive | med | `globals.css:2446-2456` | Add `max-height:calc(100vh - 32px);overflow-y:auto` to `.modal`; optionally `align-items:flex-start` on `.modal-overlay` at short heights. | S |
| 13 | `size="sm"` buttons 30px min-height (Edit/Delete/Disconnect/Move) | a11y | med | `globals.css:1478-1482` | Add `@media (pointer:coarse){.btn-sm{min-height:40px}}`. | S |
| 14 | Profile basic-info form: hardcoded 2-col grid | responsive | low | `dashboard/profile/page.tsx:252` | Replace inline `'1fr 1fr'` with `grid grid-cols-1 sm:grid-cols-2 gap-4`. | S |
| 15 | Library floating progress panel fixed 320px @ right:20px overflows ≤360px | responsive | med | `globals.css:2706-2713` | Add `@media (max-width:640px){.dashboard-v2 .floating-panel{left:12px;right:12px;width:auto}}`. | S |
| 16 | No aria-live on stream health/now-playing — up/down flips silent to SR | a11y | med | `streaming/StatusStrip.tsx:116-148` | Wrap health/now-playing container in `role="status" aria-live="polite" aria-atomic="true"`; use `role="alert"` for down/error. Mirror on Topbar live-count. | M |
| 17 | Framer Motion animations bypass reduced-motion | a11y | med | (root) `app/layout.tsx` / providers | Wrap app in `<MotionConfig reducedMotion="user">` so all `motion.*` honor OS setting. One wrapper fixes login, landing, StatCard, QuickActions. | M |
| 18 | `animate-spin` spinners freeze mid-rotation under reduced-motion | bug | low | `globals.css:96-105` | Inside reduced-motion block add `.animate-spin{animation-duration:revert!important;animation-iteration-count:infinite!important}`. | S |
| 19 | UploadModal: no focus trap / focus restore despite `aria-modal="true"` | a11y | med | `upload/UploadModal.tsx:730-737` | Port `Modal.tsx`'s focusable-query + Tab trap + `previousFocusRef` restore (lines 43-87) into UploadModal, or migrate to shared Modal. | M |
| 20 | DropdownMenu trigger missing aria-expanded/haspopup + Escape | a11y | med | `ui/DropdownMenu.tsx:29-49` | Add `aria-haspopup="menu" aria-expanded={open}` to trigger, `role="menu"`/`role="menuitem"`, Escape handler returning focus to trigger. Route default label through next-intl. | M |
| 21 | Hardcoded aria-labels (UK + EN) skip i18n | i18n | low | `streaming/IncidentTimeline.tsx:97`, `library/page.tsx:1060` | Route `aria-label="Фільтр за рівнем"` via `tHero` (add `hero.timeline.filterLabel`); `aria-label="close"` via common close key. | S |
| 22 | `.animated-gradient` purple/cyan/pink keyframe (unreferenced) | dead-code | low | `globals.css:1344-1348` | Delete the rule (grep confirms 0 source refs). | S |
| 23 | Stream tabs: no `role=tabpanel`/`aria-controls` wiring | a11y | low | `dashboard/streaming/page.tsx:419-450` | Give each panel `role="tabpanel"` + `id` + `aria-labelledby`; add `aria-controls` to each tab. | S |
| 24 | `--violet` token == `--indigo` (self-referential flat gradient) | dead-code | low | `globals.css:1572,1837` | Drop `--violet`, use solid `var(--indigo)` in the `.avatar` gradient at 1837. | S |
| 25 | Duplicate `.badge-error` (line 1409 dead, 1516 wins) | dead-code | low | `globals.css:1409-1413` | Delete the 1409 block. | S |
| 26 | Dead badge/btn variants (`badge-success/warning/info`, `btn-success`) | dead-code | low | `globals.css:1375,1403-1424` | Delete (0 source refs; replaced by SIGNAL `badge-idle/live/warn/error/indigo`). | S |
| 27 | Landing gradient-text stops still amber/purple/cyan | design | low | `globals.css:261,268` | Retint `.landing-gradient-text` to indigo-based gradient matching `--lpc-accent:#5b6cff`. | S |
| 28 | `--lpc-fg` warm off-white `#f5f3ee` | design | low | `landing/loopcast.css:13` | Shift to cool near-white `#f4f5f6` to match console `--txt`. | S |
| 29 | Landing `.lpc-wrap` keeps 32px side padding at all sizes | responsive | med | `landing/loopcast.css:97` | Add `@media (max-width:640px){.loopcast-root .lpc-wrap,.lpc-nav-inner{padding-left:18px;padding-right:18px}}`. | S |
| 30 | Landing serif numerals fixed 64/96px | responsive | med | `landing/loopcast.css:282-284,361-363` | `clamp()` for `.lpc-proof-big`/`.lpc-price-amt` to match hero/section-head pattern. | S |
| 31 | 15s API timeout not applied to body read | bug | low | `lib/api.ts:256-267,294-304` | Move `clearTimeout(timer)` to after `response.json()`, or wrap request+parse in one `Promise.race`. | M |
| 32 | Dead `StreamStatsCards` ships purple gradient | dead-code | low | `streaming/components/StreamStatsCards.tsx:42,53` | Delete file (no import site). | S |
| 33 | Orphaned `dashboard.home.*` keys (incl. 👋) | i18n/dead | low | `messages/{en,ru,uk}/dashboard.json:2-78` | Delete `dashboard.home` block in all 3 locales (page is redirect-only). | S |

**Execution note:** Items 1, 4, 5, 6, 22, 24, 25, 26 are all single-file edits in `globals.css` — batch them in one pass and verify together in the browser.

---

## 3. Structural Refactor Plan (#9) — Safest First

Each step keeps tests green because the existing test suites target the **hooks** and **pure utils**, not the JSX; pure prop-passing extractions don't move test surfaces. Verify after each commit with `npm run type-check && npm run lint && npm test`.

### R1 — `StreamBuilderModal.tsx` (507 lines) — *safest, S*
- **Extract** `StreamBuilderSummaryRail` from lines **423-503** (props: `selectedDestinations, hasVideoSelection, streamForm.name, videoEditor, assetMap, scheduleState, startAtLabel, canLaunch, onSubmit, isSubmitting, runningStreams, concurrentStreamsLimit` — all already-derived in scope).
- **Optionally** extract `StreamSourceStep` (202-307, the file/playlist tab block).
- **Risk:** low (pure presentational split; logic already in `useStreamBuilder`).
- **Green:** no hook/util signatures change; existing `useStreamBuilder` tests untouched. Preserve `'✓'/'✗'` glyphs (463-472) verbatim — do NOT lucide-ify in this pass.

### R2 — `library/page.tsx` (1229 lines) — *optional, S*
- Already well-decomposed (8 hooks, ~12 subcomponents). **Only** extract `PlaylistForm` (839-960) and `PlaylistCard`/`PlaylistList` (966-1033) from the inline Playlists tab.
- **Risk:** low. **Do NOT** touch the flat modal prop-passing block (1097-1226) — it's inherent orchestration that gains nothing.

### R3 — `admin/users/page.tsx` (651 lines) — *M*
- Three extractions: (1) `exportUsersToCsv(users, locale)` util from **218-253** (pure aside from `window`/`document` — unit-testable); (2) `useAdminUsers()` hook owning query + 3 mutations + pagination (48-113, 255-258); (3) `UserRow` subcomponent from **384-529**, moving `getTierBadgeColor` (182-194) + `formatPlanDate` (196-210) with it.
- **Risk:** low-med — card reads `user`, `tierSelections[id]`, handler closures.
- **Bonus:** `getTierBadgeColor` (185-190) still maps tiers to purple/fuchsia/amber gradients (SIGNAL violation) — fix in the same extraction (one-file change once isolated).

### R4 — `streaming/page.tsx` (933 lines) — *M*
- **Extract** `StreamLiveCard` (per-stream `<article>` at **493-636**), `ScheduledStreamsPanel` (652-695), `ArchiveStreamsPanel` (697-753).
- **Extract** pure `validateScheduleDraft(draft, destinationIds, {now})` from `handleApplyLiveEditorChanges` (188-234) into existing `schedule-utils.ts` (next to `formatDateTimeLocal`; has a co-located test file). Page maps `errorKey → toast`. Dedups validation shared with `builder-helpers.ts validateBuilder`.
- **Risk:** med — live card has inline `style` color logic (border tone, `incidentNotice` tone, 496-567). **Move it verbatim; do not refactor color logic in the same pass.**
- **Correction to source brief:** there is **no existing `StreamLogsModal.tsx`** in the repo — the `viewingLogs` block (774-894) must be extracted into a **new** component, not "folded into" an existing one.
- **Green:** blocks read only memoized values (`liveEntries`/`scheduledEntries`/`archiveEntries`, 275-319); `validateScheduleDraft` is pure date math → new unit test.

### R5 — `UploadModal.tsx` (1178 lines) — *M, do last on frontend*
- **Extract** `useUploadQueue` hook (`frontend/src/components/upload/hooks/useUploadQueue.ts`) owning `uploadItems`, uppy event subscriptions (395-522), override effect (524-544), `analyzeFile` (280-393), derived `overallProgress`/`hasBlockingUpload`. Mirrors `useLibraryUploads.ts`.
- **Then extract** `UploadItemCard` (900-1098) and `BitrateGuidanceTable` (1107-1163).
- **Risk:** med — `analyzeFile`'s `analysisQueueRef` chaining, `isMountedRef` guards, and the audio-mode `uppy.removeFile` + `setUploadItems` side-effect (319-339) must move **byte-for-byte**.
- **Green:** `uploadAnalysis.ts` util tests untouched; precompute `getStatusLabel` in parent map or pass down.

### R6 — Backend `ffmpeg_manager.py` (2040 lines) — *L, separate PRs*
- **First commit (lowest coupling):** extract the `_build_command` family (bulk of 545-809 + helpers) into `ffmpeg_command_builder.py` — near-pure, takes `PlaylistFileSet`+destinations, returns `FFmpegCommandPlan`, needs only `self.ffmpeg_bin` passed in.
- **Second commit:** runtime signal/incident tracking (1052-1370) into a `RuntimeHealthTracker` collaborator keyed by `stream_id` (holds the per-stream dicts rather than threading them).
- **Note:** `command_builder.py` and `runtime_signals.py` **already partially exist** — scope this to the *remaining* un-extracted bulk of `_build_command` and the failure/restart subsystem (`_handle_stream_failure` 1371-1572 + persistence helpers), not a greenfield split.
- **Green:** command builder is the strongest unit-test-in-isolation candidate — add tests as you extract.

### R7 — Backend `control.py` (936 lines) — *M, lower priority*
- Extract stop-attribution/audit family (789-892) into `stop_audit.py` (cohesive DB-writers, no overlap with start/quality). Factor status-payload assembly (`_status_payload`+`_get_usage_snapshot`, 722-788) into a status-builder. Package already has `control_helpers.py`/`audit.py`/`status_helpers.py` precedent.
- **Risk:** med — pass `session`/`repo` explicitly to extracted units.

---

## 4. Competitive Feature Shells (#8) — Frontend-Verifiable, Impact-Ordered

### F1 — Command palette operator verbs — *M, highest leverage*
**What:** Inject dynamic items into `commandItems` (`DashboardShell.tsx:67-87`) from the cached `streams` list.
- Per running stream: `Stop "<name>"` (red, calls `api.streams.stop`, optimistic toast).
- Per stopped stream: `Start "<name>"` (`api.streams.start`).
- Global: `Stop all live (N)` mapping over running streams.
- `Copy stream key` / `Copy YouTube watch URL` (`navigator.clipboard.writeText(\`https://www.youtube.com/watch?v=${stream.provider_video_id}\`)`, mirror `streaming/page.tsx:625`).
- Group under `nav('commands.actionsGroup')` (key already exists in en/ru/uk).
**Why cheap:** palette already supports `action?:()=>void` (`CommandPalette.tsx:17`, runItem `76-83`); only shell wiring missing. `streams`, `liveCount`, `deriveStreamState` already in shell (39-65).
**Acceptance:** ⌘K shows Start/Stop/Stop-all/Copy entries scoped to current streams; invoking an action fires the mutation and dismisses palette.
**Browser check:** open ⌘K with ≥1 running + 1 stopped stream → verify both verbs appear, `Stop all live (N)` shows correct count, Copy writes clipboard (verify via paste).

### F2 — Schedule recurrence shell — *L, biggest differentiator*
**What:** Revive `/dashboard/schedule` (currently `redirect('/dashboard/streaming')`, `schedule/page.tsx:11-13`). Add a `Repeat` control (none/daily/weekdays/weekly-on-[day chips]) + a 7-col × time-row weekly grid preview visualizing planned windows, stored as optimistic draft.
**Why:** Whole pitch is "24/7 unattended"; Upstream.so/OneStream lead with recurring calendars. `schedule-utils.ts` has only `DURATION_PRESETS` — zero recurrence concept anywhere.
**Acceptance:** `/dashboard/schedule` renders the grid (not a redirect); selecting repeat mode + day chips paints corresponding cells; draft persists in component/localStorage.
**Browser check:** navigate to `/dashboard/schedule`, pick "weekly" + Mon/Wed/Fri → grid highlights those columns; reload preserves draft (frontend-only, no backend).

### F3 — Streaming density / compact toggle — *M*
**What:** Add comfortable/compact segmented toggle in page-actions (`streaming/page.tsx:367-372`), persisted to localStorage (reuse `readSidebarCollapsed` pattern). Compact mode collapses each running stream to `StatusStrip` + single bitrate row, hides the duplicate `stream-summary-card`.
**Why:** Library already has the primitive (`AssetCard.tsx:44` `density?:'comfortable'|'compact'`, `:129` `isCompact`); streaming forces a wall of hero cards on multi-stream operators.
**Acceptance:** toggle switches live tab between hero view and compact roster; choice survives reload; the second per-stream `stream-summary-card` (470-637) is hidden in compact.
**Browser check:** with 3+ running streams, flip to compact → each stream is one row, total scroll height drops; reload keeps compact.

### F4 — Health spine + global status chip (from plan §3.3 B1) — *M*
**What:** New `HealthSpine.tsx` under topbar: 2px bar, one segment per stream colored by status, plus topbar global chip (`● N live · ▲ M warning`). Hover segment → mini-card.
**Why:** Plan's signature "answerable at a glance" surface; not yet built.
**Acceptance:** spine + chip render on every dashboard page; segment count == stream count; colors match `deriveStreamState`.
**Browser check:** seed mixed live/warn/down states → spine shows correct colors, chip counts match, hover pops mini-card.

---

## 5. Do-NOT Guardrails

1. **Do NOT blanket-delete the `stream-v3-*` block.** Only `stream-v3-globe-canvas` is genuinely live (`Hero3DGlobe.tsx:372`, dynamic-imported by `HomePageClient`). `stream-v3-display`/`stream-v3-footer` live only in **dead** `Footer.tsx`/`LandingNavBar.tsx`. Scope deletion to lines **334-413** (bg-effects) + their 6 orphaned keyframes (819,1428,1433,1440,1447,1453), and delete the 10 orphaned landing components (`HeroSection, FeaturesGrid, PricingCards, BenefitsSection, ComparisonTable, CTASection, StatsSection, AnimatedBackground, ImmersiveBackground, LandingNavBar`) **with their tests** as a separate, isolated commit — verify `/` still renders after.
2. **Do NOT refactor inline `style` color logic during structural extraction** (R4 live card, R5 audio-mode side-effect). Move byte-for-byte; retint is a *separate* pass.
3. **Do NOT lucide-ify the `'✓'/'✗'` readiness glyphs** in StreamBuilderModal (463-472) during R1 — out of scope for decomposition.
4. **Do NOT introduce a custom focus trap from scratch** for UploadModal (#19) — reuse `Modal.tsx`'s proven logic to avoid divergent implementations.
5. **Do NOT change visible English/Russian copy** while fixing i18n leaks (#3, #7, #8) — only add the missing keys and route through existing translators; keep existing `streaming.provider.*` duplicate for any other consumer.
6. **Do NOT delete `LoadingState.tsx`'s `LoadingSpinner`** assuming it's the rendered offender — it's dead code; the live `LoadingState` component (lines 18-27) has the same defect. Gate via `useReducedMotion()` only if you also fix the rendered one; otherwise skip (covered structurally by #17 MotionConfig).
7. **Do NOT touch the `tailwind.config.js` `primary`/`accent` ramps** — they are already correctly retinted to indigo/blue. The leaks are raw `purple`/hex literals and `oklch` hue-295 that bypass the tokens; fix those, not the config.
8. **Do NOT add `min-height` to `.btn-sm` unconditionally** (#13) — gate behind `@media (pointer:coarse)` so desktop dense rows keep current sizing.

**Suggested commit order for top-down execution:** §2 batched globals.css cleanup (1/4/5/6/22/24/25/26) → i18n leaks (3/7/8/21/33) → responsive (9/10/11/12/13/14/15/29/30) → a11y (16/17/18/19/20/23) → dead-code deletions (guardrail-scoped) → refactors R1→R7 → features F1→F4.

**Key files:** `~/Documents/Work/youtube_translation/frontend/src/app/globals.css`, `~/Documents/Work/youtube_translation/frontend/src/components/landing/loopcast.css`, `~/Documents/Work/youtube_translation/frontend/src/app/login/page.tsx`, `~/Documents/Work/youtube_translation/frontend/src/app/dashboard/{streaming,channels,profile,library,schedule}/page.tsx`, `~/Documents/Work/youtube_translation/frontend/src/app/dashboard/streaming/{platform.ts,hooks/useStreamingPageData.ts,hooks/useStreamMutations.ts,components/StreamBuilderModal.tsx}`, `~/Documents/Work/youtube_translation/frontend/src/components/{layout/DashboardShell.tsx,ui/{Modal,DropdownMenu,CommandPalette}.tsx,upload/UploadModal.tsx,streaming/StatusStrip.tsx}`, `~/Documents/Work/youtube_translation/frontend/src/lib/api.ts`, `~/Documents/Work/youtube_translation/frontend/src/messages/{en,ru,uk}/{streaming,dashboard,nav}.json`, `~/Documents/Work/youtube_translation/frontend/src/app/admin/users/page.tsx`, `~/Documents/Work/youtube_translation/backend/app/streaming/ffmpeg_manager.py`, `~/Documents/Work/youtube_translation/backend/app/services/streams/control.py`.