# Test Spec: Dashboard Clarity and UX Simplification

## Purpose

Define execution-ready verification gates for simplifying the authenticated UX while preserving operational correctness for a 24/7 streaming product.

Covered surfaces:
- `dashboard`
- `streams`
- embedded `channels`
- `stream builder`
- `library`
- `upload flow`
- quota/time semantics

## Evidence Base

- Mixed dashboard responsibilities: `frontend/src/app/dashboard/page.tsx:152-259`
- Browser-midnight usage math: `frontend/src/app/dashboard/page.tsx:65-112`
- Quick-action page hops: `frontend/src/components/QuickActions.tsx:13-31`
- Richer live-state handling on streaming surface: `frontend/src/app/dashboard/streaming/page.tsx:95-151`
- Dense stream cards: `frontend/src/app/dashboard/streaming/components/StreamsList.tsx:131-320`
- Five-tab builder + collection persistence: `frontend/src/app/dashboard/streaming/components/StreamBuilderModal.tsx:169-215`, `frontend/src/app/dashboard/streaming/hooks/useStreamBuilder.ts:269-428`
- Upload modal complexity: `frontend/src/components/upload/UploadModal.tsx:1082-1368`
- Existing stream creation schema supports multiple source modes: `backend/app/schemas/api.py:234-320`
- Destination contract is currently narrow: `frontend/src/lib/types.ts:180-204`
- Locale/timezone infrastructure already exists: `frontend/src/lib/api.ts:50-63`, `frontend/src/lib/api.ts:189-192`, `backend/app/services/streams/service.py:306-355`, `backend/app/core/stream_schedule.py:12-115`

## Testable Assumptions

1. The product should treat `Streams` as the authoritative operator surface.
2. `Overview` should summarize shared truth, not create its own truth model.
3. First-run progress can be derived from account resources without a separate onboarding state engine.
4. Builder UX can be simplified without changing the underlying collection-based persistence model in MVP.
5. Upload UX should front-load progress/readiness and delay technical diagnostics until they are useful.
6. Quota-facing UI should match backend rolling 24-hour semantics.

## Fixture Matrix

### F0: Empty account

State:
- no assets
- no destinations
- no streams

Purpose:
- verify first-run CTA and empty-state clarity

Expected:
- `Overview` recommends upload first
- `Streams` explains prerequisites in order
- no speculative live or events content appears

### F1: Assets only

State:
- 1+ assets
- no destinations
- no streams

Purpose:
- verify second-step onboarding

Expected:
- next action is `Connect your first channel`
- upload success/readiness is visible

### F2: Assets + destination, no streams

State:
- 1+ assets
- 1 enabled destination
- no streams

Purpose:
- verify first stream creation entry point

Expected:
- next action is `Create your first stream`
- builder opens in a guided, non-expert path

### F3: Scheduled stream

State:
- 1 scheduled stream

Purpose:
- verify schedule clarity and primary action policy

Expected:
- stream card shows next schedule clearly
- primary action is schedule-related, not destructive

### F4: Running stream

State:
- 1 running stream with live status freshness available

Purpose:
- verify authoritative operator state

Expected:
- `Streams` shows live status, uptime, and `Stop`
- `Overview` reflects the same status through shared truth

### F5: Running stream with stale/unavailable status detail

State:
- 1 running stream in list
- status endpoint unavailable, stale, or delayed

Purpose:
- verify honest degraded-state handling

Expected:
- UI does not silently downgrade to an incorrect stopped state
- stale or degraded hint appears if freshness cannot be confirmed

### F6: Errored stream with retry scheduled

State:
- stream has error state
- runtime restart is scheduled or retrying

Purpose:
- verify “needs attention” grouping and recovery cues

Expected:
- stream appears in attention group
- primary action reflects recovery context
- retry metadata remains reachable as secondary detail

### F7: Quota near limit / quota reached

State:
- usage near 24-hour limit
- usage at or over limit

Purpose:
- verify quota semantics and copy

Expected:
- labels use rolling 24-hour meaning
- `/dashboard` and `/streams` do not imply local-midnight “today” logic

### F8: Locale switching

State:
- same account viewed in `uk`, `ru`, `en`

Purpose:
- verify absolute/relative time presentation

Expected:
- absolute dates are locale-aware
- relative times remain readable and consistent

### F9: Mobile viewport

State:
- any of F0, F4, F6 rendered on narrow viewport

Purpose:
- verify first CTA and live status remain visible without layout collapse

Expected:
- one primary next action remains obvious
- live state remains legible

## Verification Lanes

### Lane 1: Truth and semantics verification

Checks:
1. Compare dashboard usage labels against `/api/quota`.
2. Confirm live-state parity between `Overview` and `Streams`.
3. Confirm stale/unavailable status is surfaced honestly.
4. Confirm first-run state is derived from real resource presence, not hidden assumptions.

Pass condition:
- no semantic contradiction remains between overview, streams, and backend truth

### Lane 2: Streams and embedded Channels

Checks:
1. Verify state grouping:
   - `Live now`
   - `Scheduled`
   - `Needs attention`
   - `Stopped`
2. Verify stream cards expose:
   - name
   - destination
   - status
   - uptime or next schedule
   - one primary action
3. Verify channel management remains reachable without becoming the dominant visual burden.

Pass condition:
- operator can answer “what is live, what is broken, what do I do next?” in a few seconds

### Lane 3: Builder and upload/library flow

Checks:
1. Create a first stream starting from F2 without visiting expert-only surfaces.
2. Open advanced/customize paths and verify:
   - timeline editing
   - audio setup
   - schedule control
   - destination control
3. Verify the `Review & Launch` step summarizes:
   - selected content
   - selected destination/channel
   - schedule mode
   - the final launch action
3. Open upload modal with no files selected.
4. Add one healthy file and one warning-heavy file.

Pass condition:
- first-run path is simple
- power-user path is preserved
- upload progress/readiness precedes heavy diagnostics

### Lane 4: Overview clarity

Checks:
1. On F0, verify one obvious first action appears above the fold.
2. On F4, verify overview communicates live summary without duplicating full operator detail.
3. On F6, verify overview communicates attention without pretending to be the log console.

Pass condition:
- overview is summary-first, honest, and non-duplicative

## Suggested Regression Coverage

Frontend tests:
- dashboard truth-adapter rendering
- dashboard next-step derivation
- stream-list primary-action selection by state
- stream-list attention grouping and stale-status rendering
- builder step validation
- builder happy path with hidden collection persistence
- upload flow state transitions
- locale-aware date formatting helpers

Manual/integration tests:
- F0 through F9 fixture walkthroughs
- `/api/quota` comparison against visible labels
- running-stream parity between `Overview` and `Streams`
- stale-status fallback behavior

## Manual Review Checklist

- [ ] `Streams` is visibly the authoritative operator surface.
- [ ] `Overview` summarizes shared truth instead of re-deriving its own.
- [ ] The first-run next action is deterministic for F0, F1, and F2.
- [ ] Stream cards prioritize state and action over metadata density.
- [ ] Primary and destructive actions are no longer visually equivalent.
- [ ] Builder follows a guided sequence for first-run users.
- [ ] Advanced controls remain reachable.
- [ ] Upload modal starts simple and becomes technical only when useful.
- [ ] Quota/time labels match backend rolling 24-hour semantics.
- [ ] Absolute dates are locale-aware.
- [ ] Mobile layouts preserve primary CTA and live-state visibility.

## Exit Gates

### Planning Gate

The redesign is ready for execution only when:
- Phase 0 ADRs are accepted
- the `B -> A` sequencing is preserved
- channels remain explicitly embedded for MVP unless a wider contract is approved
- the builder persistence model is explicitly kept or explicitly changed
- fixture matrix F0-F9 is accepted as the baseline verification set

### Execution Gate

The simplification work is complete when:
- all PRD acceptance criteria are met
- F0-F9 walkthroughs pass
- overview and streams show parity for shared live-state truth
- quota-facing labels match backend semantics
- no previously available critical operational capability is lost
