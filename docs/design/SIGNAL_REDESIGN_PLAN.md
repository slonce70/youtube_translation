<!-- Generated 2026-06-20 by multi-agent competitive-plan workflow. Canonical design+implementation reference for the SIGNAL redesign. -->

# Loopcast Implementation Plan — "SIGNAL": The Live Control-Room Console

## 1. Executive Summary

Loopcast will become the **mission-control console for 24/7 unattended streaming** — the product that makes "is everything OK?" answerable at a glance from any screen, that lets operators edit the live queue while it airs, and that surfaces YouTube live telemetry no competitor exposes. "Better than competitors" concretely means three measurable wins: (1) one unified, accessible visual language replacing the current three (`landing-*` editorial warmth, `stream-v3-*` neon red/cyan, `dashboard-v2` OLED purple), lifting accessibility from ~4/10 to WCAG-AA across primary flows; (2) the two ownable differentiators competitors lack — a **hot-swappable live playlist** and **live YouTube viewer/stream-health telemetry rendered as ambient chrome** (the signal sparkline + master-control health spine); (3) operator-grade UX polish (command palette with operator verbs, two density modes, consistent empty/loading/error states) that beats Castr/Gyre's utilitarian feel and matches StreamYard's calm. The design language is **SIGNAL**: a single cool-gray neutral spine, one electric-indigo accent, semantic-only chroma where green=live and red=broken, mono+tabular numbers that never odometer-animate, and elevation built from a surface ladder plus hairlines rather than glows. Everything below is ordered so an autonomous agent can ship and browser-verify each step without a running backend, by driving the existing Next.js dev server and mocked/seeded UI states.

## 2. Competitive Gap Analysis

Prioritized by impact-over-effort, flagged for what an agent can verify in a browser without the backend.

| Gap | Competitor who has it | Impact | Effort | Frontend-verifiable |
|---|---|---|---|---|
| Unified design tokens (kill 3 visual languages) | StreamYard (single calm language) | **High** — foundation for everything; current fragmentation is the #1 quality drag | M | **Yes** — visual diff across all pages |
| Live playlist hot-swap while airing | Upstream (yes); Restream/OneStream lock it | **High** — most ownable wedge | L | **Yes** — drag-reorder UI + optimistic mutation, mockable |
| Live YouTube viewer + stream-health telemetry | Nobody surfaces it well | **High** — the visible differentiator | M | **Yes** — sparkline/health spine renders from mock data |
| Consistent empty/loading/error (`<DataState>`) | StreamYard (polished) | **High** — fixes "inconsistent states" structurally | S | **Yes** — toggle states in browser |
| Accessibility (focus, contrast, reduced-motion, aria-live) | None strong | **High** — currently ~4/10 | M | **Yes** — axe/keyboard/contrast checks |
| Command palette with operator verbs | Linear/Raycast pattern; competitors lack | Medium | S | **Yes** — `⌘K` flows |
| YouTube auto go-live + metadata (title/desc/thumb/category) | Restream, Upstream | High (product) | L | **Partial** — UI/form verifiable; live action needs backend |
| Unified comments inbox | StreamYard (signature); OneStream lacks | Medium | L | **Partial** — UI shell verifiable, data needs backend |
| Two density modes (comfortable/compact) | None | Medium | S | **Yes** — token swap toggle |
| Auto-restart / A/B failover narrative | Castr, Upstream | High (product) | L | **Partial** — status UI verifiable, behavior backend |
| Resumable uploads (fix Gyre's 85% bug) | — (beat their weakness) | Medium | M | Partial (Uppy/tus already present) |
| Mobile monitoring | None (all browser-only/weak) | Medium | L | Yes (responsive) — defer this pass |
| Real closed captions / CC | None | Low-Med | L | No — defer |

## 3. Chosen Design Language — SIGNAL (decided, not hedged)

I am merging the three proposals into **one** system and committing. The decision: **SIGNAL** as named — the cool-gray neutral spine + **electric indigo accent `#5B6CFF`** (not the violet `#6E56F4`, not cyan, not the warm-serif "Editorial Operator" direction). Rationale: the existing dashboard already ships an OLED dark base and JetBrains Mono is already loaded, so this is the lowest-migration-risk, highest-coherence target. **Inter for UI, JetBrains Mono for all changing numbers, NO serif in-app** (the serif is permitted only on the marketing/login splash — retiring `--font-display`/`--font-serif`/Manrope `--font-tech` from the console). This is decisive: one neutral spine, one accent, semantic-only chroma, green=live/red=error.

### 3.1 Final token spec (authoritative — paste into `globals.css` `:root`)

```css
:root {
  /* neutral spine — cool-gray ~265°, dark-first */
  --bg-canvas:#08090A; --bg-base:#0C0D0F;
  --surface-1:#111316; --surface-2:#16181C; --surface-3:#1C1F24; --surface-4:#262A31;
  --border-subtle:#1F2227; --border-default:#2A2E35; --border-strong:#3A3F47;
  --text-primary:#F4F5F6; --text-secondary:#B4B8BF; --text-muted:#8A8F98; --text-disabled:#5A5F68;
  /* single accent — electric indigo */
  --accent:#5B6CFF; --accent-hover:#4A5BF0; --accent-active:#3D4DE0;
  --accent-subtle:rgba(91,108,255,.12); --accent-text:#A6B0FF; --accent-fg:#FAFAFB;
  --accent-ring:rgba(91,108,255,.45);
  /* semantic / signal — derived for uniform contrast */
  --live:#3FB950; --live-text:#56D364; --live-bg:rgba(63,185,80,.12);
  --info:#58A6FF; --info-text:#79C0FF; --info-bg:rgba(88,166,255,.12);
  --warn:#D29922; --warn-text:#E3B341; --warn-bg:rgba(210,153,34,.12);
  --danger:#F85149; --danger-text:#FF7B72; --danger-bg:rgba(248,81,73,.12);
  --idle:#8A8F98; --idle-text:#B4B8BF; --idle-bg:rgba(138,143,152,.10);
  /* radius */
  --radius-xs:4px; --radius-sm:6px; --radius-md:8px; --radius-lg:12px; --radius-full:9999px;
  /* shadow — overlays only, each with hairline ring */
  --shadow-popover:0 8px 24px rgba(0,0,0,.40),0 0 0 1px rgba(0,0,0,.20);
  --shadow-modal:0 24px 48px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.30);
  --shadow-toast:0 8px 20px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.20);
  /* motion */
  --ease-out:cubic-bezier(.16,1,.3,1); --ease-in-out:cubic-bezier(.4,0,.2,1);
  --dur-fast:120ms; --dur-base:200ms; --dur-slow:320ms;
  /* type */
  --font-sans:"Inter",system-ui,sans-serif; --font-mono:"JetBrains Mono",ui-monospace,monospace;
  /* density (default comfortable) */
  --row-h:40px; --card-pad:16px; --input-h:36px; --cell-y:12px;
}
[data-density="compact"]{ --row-h:32px; --card-pad:12px; --input-h:32px; --cell-y:8px; }
@media (prefers-reduced-motion:reduce){ :root{ --dur-fast:1ms; --dur-base:1ms; --dur-slow:1ms; } }
```

**Backward-compat aliases (keep one release to avoid churn across existing selectors):** map old HSL `--primary`/`--accent` consumers and `dashboard-v2`/`stream-v3` vars to the new tokens via alias declarations, then remove after migration. The `tailwind.config.js` shadcn HSL block (`--background`, `--primary 271 91% 65%`, `--accent 189 94% 43%`) is re-pointed to the new vars.

### 3.2 Typography (final)
- **UI/sans:** Inter (`cv05`, `tnum`), weights 400/500/600; emphasis = 510 via variation-settings, fallback 500.
- **Data/mono:** JetBrains Mono, always `tabular-nums`, for bitrate/fps/uptime/viewers/IDs/keys/timestamps/logs.
- **No serif in-app.** Remove IBM_Plex_Serif/Instrument_Serif/Manrope from the dashboard; keep serif only on marketing/login.
- Scale: `display 28/600`, `h1 22/600`, `h2 18/510`, `h3 15/510`, `body 14/400`, `body-sm 13/400`, `label 12/500 +0.04em UPPERCASE`, `caption 11/400`, `mono-data 13/450`. **Body is 14px, not 16.**

### 3.3 Component specs (final, abbreviated — full rules per SIGNAL proposal §3)
- **Shell:** 240px sidebar (→56px rail), pinned **"LIVE NOW"** section; 52/44px topbar with **global status chip** (`● 3 live · ▲ 1 warning`); **2px health spine** under topbar, one segment per stream, color = status.
- **Buttons (CVA):** Primary (flat `--accent`, no gradient/glow — kill `hover:scale-105 shadow-glow`), Secondary, Ghost, Danger. 36/32px.
- **Cards:** `surface-1`, 1px `border-subtle`, `radius-md`, hover → `border-strong` only (no lift). **Stream card** = hero: 16:9 preview + live badge + status-colored 2px left border + mono metric row + bitrate sparkline.
- **Status badge:** dot+label always; hollow=idle, filled=active, filled+pulse=live.
- **Live indicator:** green dot + expanding pulse (`scale 1→2.2, opacity .55→0, 1.9s`), `LIVE · 14:23:07` mono; static under reduced-motion.
- **Table:** sticky `surface-2` header, `--row-h` rows, dividers only (zebra-free), numeric cols right-aligned mono `tnum`.
- **`<DataState>`:** one wrapper → loading (layout-matched skeletons) / empty-first-run / empty-configured / filtered-zero / error. Spinners only inside buttons.
- **Toast:** bottom-right `surface-3`, success auto-dismiss 4s, **errors persist**; critical failure also raises inline banner on the stream.
- **Modal + `⌘K` palette:** focus-trapped; palette with operator verbs (Start/Stop all/Restart encoder/Copy key/Go to channel).

## 4. Information Architecture (final nav/route structure)

The existing routes are close; consolidate and rename for operator clarity. Final operator nav (sidebar order):

```
/dashboard                → Overview (home: Live Now wall + health spine + quick actions)
/dashboard/streaming      → Streams (list + builder + live editor)  [PRIMARY]
   /dashboard/streams/[id]    → Stream detail (now-playing, hot-swap queue, telemetry, logs)
   /dashboard/streams/new     → Stream wizard
/dashboard/library        → Media Library (assets, folders, upload)
/dashboard/channels       → Channels (YouTube connect: OAuth + stream key, metadata)
/dashboard/schedule       → Schedule (recurrence grid)
/dashboard/plans          → Plans & Billing
/dashboard/profile        → Settings (profile, density, prefs)
```
Pinned in sidebar bottom: **LIVE NOW** rail (active streams + uptime). Topbar: breadcrumb + global health chip + `⌘K` + account. Admin (`/admin/*`) stays separate, reskinned to same tokens. **Decision:** merge `/dashboard/streaming` (list) as the canonical "Streams" entry and route per-stream work to `/dashboard/streams/[id]` (already exists) to avoid the current split confusion.

## 5. Prioritized Implementation Backlog (ordered by impact-over-risk)

### Phase A — Unify design tokens (foundation)

**A1. Token foundation + Tailwind rewire** — *S/M, low-med risk*
- Files: `src/app/globals.css` (add §3.1 token block under `@layer base :root`), `tailwind.config.js` (re-point `colors`/`boxShadow`/`borderRadius`/`fontFamily` to vars; drop cyan `accent.50-900`, purple `primary.50-900`, `gradient-hero/mesh/conic`, `shadow-glow*`, `float/gradient/pulse-slow/bounce-slow` animations), `src/app/layout.tsx` (drop serif/Manrope from dashboard; keep Inter + JetBrains Mono vars).
- Acceptance: app builds (`npm run type-check`, `npm run lint`); old token names still resolve via aliases; no page throws.
- Browser check: load `/dashboard/streaming` — no neon red/cyan, no purple glow; single dark spine + indigo accent.
- Risk: 1300+ selectors reference old vars — mitigate with aliases for one release.

**A2. Retire fragmented language CSS** — *M, med risk*
- Files: `src/app/globals.css` (remove `stream-v3-*` ~lines 252-700, `landing-*` warm gradients, `animated-gradient`/`float`/`gradient-text`/`glow-effect`), `src/components/landing/loopcast.css` (fold into tokens), landing components using removed classes.
- Acceptance: no references to deleted classes (`grep` clean); landing reskinned on tokens with one allowed accent radial on hero.
- Browser check: `/` landing renders without warm/neon artifacts; `/dashboard/streaming` clean.
- Risk: visual regressions on landing — verify each landing section in browser.

### Phase B — Refresh shell + streaming dashboard

**B1. Reskin shell (sidebar/topbar) + LIVE NOW rail + health spine** — *M, low risk*
- Files: `src/components/layout/{Sidebar,Topbar,DashboardShell}.tsx`, new `src/components/layout/HealthSpine.tsx`.
- Acceptance: active nav = `accent-subtle` + 2px accent edge; LIVE NOW rail shows active streams + mono uptime; 2px health spine under topbar with per-stream segments + global status chip.
- Browser check: navigate dashboard pages; spine + chip visible on every page; hover segment pops mini-card.

**B2. Core primitives: `<StatusBadge>`, `<LiveIndicator>`, `<StreamCard>`, button refactor** — *M, low risk*
- Files: `src/components/ui/Button.tsx` (CVA flat variants, strip scale/glow), `src/components/ui/LiveDot.tsx`, `src/components/streaming/{HeroTile,LiveStreamHero,StatusStrip}.tsx`, `src/components/ui/Badge.tsx`.
- Acceptance: one StreamCard component consumed across streaming pages; pulse respects reduced-motion; numbers mono+tnum.
- Browser check: stream cards render uniform; toggle `prefers-reduced-motion` → pulse static.

**B3. Streaming dashboard page recompose** — *M, med risk* (file is 933 lines)
- Files: `src/app/dashboard/streaming/page.tsx`, `components/StreamsList.tsx`.
- Acceptance: page uses StreamCard grid + DataState + health-aware metric rows; no inline neon styles.
- Browser check: `/dashboard/streaming` renders grid; states (loading/empty/error) consistent.

### Phase C — Empty/loading/error + a11y

**C1. Shared `<DataState>` wrapper** — *S, low risk*
- Files: new `src/components/ui/DataState.tsx`, refactor `LoadingState.tsx`/`QueryStateCard.tsx` consumers.
- Acceptance: 4 modes (loading skeleton / first-run / empty-configured / filtered-zero+error) via one API; skeletons match layout.
- Browser check: force each state via query param or mock; visually consistent across library/streaming/channels.

**C2. Accessibility pass** — *M, med risk*
- Files: `globals.css` (`:focus-visible` ring `0 0 0 2px var(--bg-base),0 0 0 4px var(--accent)`), status components (dot+label+icon, never color-alone), `aria-live` on status changes (polite) and failures (assertive), modal/palette focus trap + restore, skip-to-content.
- Acceptance: keyboard reaches all hover-revealed row actions; contrast ≥4.5:1 body / 3:1 UI; reduced-motion kills pulse/scale.
- Browser check: tab through dashboard (visible rings); run axe; toggle reduced-motion.

### Phase D — Library + channels + plans polish

**D1. Library reskin + decompose** — *L, med risk* (1229-line `page.tsx`, 1178-line `UploadModal.tsx`)
- Files: `src/app/dashboard/library/page.tsx`, `components/library/{AssetCard,FolderCard,Breadcrumbs}.tsx`, `components/upload/UploadModal.tsx`.
- Acceptance: table = zebra-free dividers, mono numeric cols, DataState states; AssetCard on tokens.
- Browser check: `/dashboard/library` grid + table render; upload modal opens clean.

**D2. Channels + plans reskin** — *M, low risk*
- Files: `src/app/dashboard/channels/page.tsx`, `components/streaming/AddChannelModal.tsx`, `src/app/dashboard/plans/page.tsx`.
- Acceptance: channel connect shows OAuth + stream-key paths; masked key field with copy; plans cards on tokens (flat, no glow).
- Browser check: both pages render; AddChannel modal focus-trapped.

### Phase E — Frontend-visible competitive feature gaps

**E1. Command palette operator verbs** — *S, low risk*
- Files: `src/components/ui/CommandPalette.tsx`.
- Acceptance: grouped results (Actions/Streams/Media/Channels/Nav); verbs Start/Stop all/Restart encoder/Copy key/Go to channel; fuzzy + arrow-nav.
- Browser check: `⌘K` opens, verbs listed, Enter navigates.

**E2. Live signal sparkline + telemetry (the wedge)** — *M, med risk*
- Files: `src/components/streaming/Sparkline.tsx` (already exists), StreamCard, HealthSpine, `src/app/dashboard/streams/[id]/page.tsx`.
- Acceptance: bitrate sparkline (60s, 1.5px stroke), stroke color = health (green→amber→danger), append+shift not redraw, reduced-motion static. Renders from mock data when backend absent.
- Browser check: stream detail shows sparkline animating from seeded data; degrade mock → amber/red.

**E3. Hot-swap live queue (the most ownable wedge)** — *L, med risk*
- Files: `src/components/streaming/NowPlayingPanel.tsx`, `LiveEditorModal.tsx`, `streaming/hooks/useStreamBuilder.ts`.
- Acceptance: drag-reorder queue while "airing" with optimistic TanStack mutation + FLIP reorder ≤200ms; crossfade seam on next-up; next/skip/replay controls.
- Browser check: reorder queue in browser, optimistic UI updates, FLIP animates; works against mock mutation.

**E4. YouTube metadata form (auto go-live UI shell)** — *M, low risk (UI only)*
- Files: channels/stream builder forms.
- Acceptance: title/description/category/privacy/thumbnail fields + "auto go-live" toggle present; validation; submit wired to existing API client (no-op/mock if backend down).
- Browser check: form renders, validates, submits without console errors.

### Phase F — Structural cleanup of oversized files

**F1. Decompose oversized pages** — *M, low-med risk*
- Files: `library/page.tsx` (1229), `UploadModal.tsx` (1178), `streaming/page.tsx` (933), `admin/users/page.tsx` (651), `landing/HomePageClient.tsx` (663).
- Acceptance: each split into focused sub-components/hooks under existing `components/`+`hooks/` dirs; behavior unchanged; tests green.
- Browser check: each affected page renders identically post-split.
- Risk: do this LAST, after visual layer stable, to avoid compounding regressions.

## 6. What to Explicitly NOT Do This Pass (scope guardrails)

1. **Do not build backend integrations** — no real YouTube Data API auth/go-live, no live telemetry pipeline, no failover logic. Ship UI shells + mock/optimistic states only; backend is not runnable locally.
2. **Do not add a light theme** for the console. Dark is the only first-class theme this pass (light stays for marketing only).
3. **Do not ship a native mobile app or mobile-specific monitoring** — responsive is fine, but the mobile moat is a future pass.
4. **Do not implement closed captions / CC tracks** — deferred.
5. **Do not rewrite data-fetching/state architecture** (TanStack Query, Supabase, API client stay as-is) — reskin and recompose, don't re-plumb.
6. **Do not remove backward-compat token aliases in the same PR that introduces new tokens** — keep one release of overlap to protect the 1300+ existing selectors.
7. **Do not touch admin functionality/logic** — reskin `/admin/*` to tokens only; no behavior changes.
8. **Do not introduce new heavy deps** — use existing framer-motion (modal/FLIP only), CVA+clsx+tailwind-merge, plain CSS/SVG/canvas for pulse+sparkline. Drop `three`/Hero3DGlobe from critical path if it fights the calm language (optional, marketing-only).
9. **Do not animate ticking metrics** (no odometer roll on bitrate) and do not add decorative/looping motion — enforce the motion guardrails.
10. **Do not break i18n** — all new strings go through next-intl; run `npm run i18n:check` before each merge.

---

**Key files for execution (absolute paths):**
- `/Users/trend/Documents/Work/youtube_translation/frontend/src/app/globals.css` (2942 lines — token block + 3 languages to collapse)
- `/Users/trend/Documents/Work/youtube_translation/frontend/tailwind.config.js` (colors/shadow/animation rewire)
- `/Users/trend/Documents/Work/youtube_translation/frontend/src/app/layout.tsx` (font wiring — drop serif/Manrope in-app)
- `/Users/trend/Documents/Work/youtube_translation/frontend/src/components/layout/{Sidebar,Topbar,DashboardShell}.tsx` (shell)
- `/Users/trend/Documents/Work/youtube_translation/frontend/src/app/dashboard/streaming/page.tsx` (933) + `components/{StreamsList,StreamBuilderModal,LiveEditorModal}.tsx`
- `/Users/trend/Documents/Work/youtube_translation/frontend/src/app/dashboard/library/page.tsx` (1229) + `src/components/upload/UploadModal.tsx` (1178)
- `/Users/trend/Documents/Work/youtube_translation/frontend/src/components/streaming/{Sparkline,NowPlayingPanel,LiveStreamHero,StatusStrip,HeroTile}.tsx` (wedge components)
- `/Users/trend/Documents/Work/youtube_translation/frontend/src/components/ui/{Button,Badge,LiveDot,CommandPalette,Modal}.tsx` + new `DataState.tsx` (primitives)

Browser verification harness: drive `npm run dev` and inspect `/`, `/login`, `/dashboard/streaming`, `/dashboard/streams/[id]`, `/dashboard/library`, `/dashboard/channels`, `/dashboard/plans` — toggling `prefers-reduced-motion` and `data-density` and forcing DataState modes via query params/mocks, since the backend is not fully runnable locally.