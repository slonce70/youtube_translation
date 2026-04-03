# PRD: Dashboard Clarity and UX Simplification

## Requirements Summary

Redesign the authenticated product UX so it feels simpler, more trustworthy, and more obviously built for one core job: keep a channel live 24/7 with minimal babysitting.

Grounding facts:
- The current overview dashboard mixes subscription, usage, quick actions, live control, progression, and checklist content in one screen in `frontend/src/app/dashboard/page.tsx:152-259`.
- The real operator surface today is `frontend/src/app/dashboard/streaming/page.tsx:65-240`, which owns stream actions, per-stream status polling, scheduling, channel management, logs, and creation flows.
- The dashboard usage widget computes “daily” streaming usage from browser-local midnight in `frontend/src/app/dashboard/page.tsx:65-112`, while backend quota enforcement uses a rolling 24-hour window in `backend/app/core/quota.py:182-245`.
- The stream management list exposes too many secondary details at once in `frontend/src/app/dashboard/streaming/components/StreamsList.tsx:131-320`.
- The stream builder currently exposes a five-tab expert model and persists media collections during creation in `frontend/src/app/dashboard/streaming/components/StreamBuilderModal.tsx:169-215` and `frontend/src/app/dashboard/streaming/hooks/useStreamBuilder.ts:269-428`.
- The upload modal exposes compatibility education and technical analysis too early in `frontend/src/components/upload/UploadModal.tsx:1082-1368`.
- The library page combines assets, folders, playlists, bulk actions, stats, and modal workflows in one surface in `frontend/src/app/dashboard/library/page.tsx:1630-2165`.
- The current destination data contract is narrow: `name`, `rtmps_url`, `enabled`, and masked key in `frontend/src/lib/types.ts:180-204`; it does not yet support richer “channel health” semantics.
- Timezone infrastructure for scheduling is already structurally sound:
  - frontend resolves and sends user timezone in `frontend/src/lib/api.ts:50-63` and `frontend/src/lib/api.ts:189-192`
  - backend stores and evaluates `schedule_timezone` with `ZoneInfo` in `backend/app/services/streams/service.py:306-355` and `backend/app/core/stream_schedule.py:12-115`
- User-facing “recent events” data does not currently exist as a clear product surface; current alerts are admin-oriented in `backend/app/api/routes/admin.py:170-245`.

External research signals:
- [playout.video](https://playout.video/help-center/destinations-platforms/connecting-streaming-platforms) documents a flow centered on Channels -> Destinations -> Go Live and emphasizes hands-free automation.
- [LoopingStream](https://loopingstream.com/blog/) markets the product as a short path from prepared content to 24/7 live streaming, not as a broad media operating system.

## RALPLAN-DR Summary

### Principles

1. One screen should have one primary job.
2. Status and trust signals must appear before configuration detail.
3. First-run flows should optimize for completion, not maximum flexibility.
4. Advanced controls should remain available behind progressive disclosure.
5. 24/7 streaming UX must foreground what is live, what is broken, and the next best action.

### Decision Drivers

1. Reduce first-run cognitive load.
2. Preserve advanced operational power.
3. Align time, quota, and live-state semantics with backend truth.

### Viable Options

#### Option A: Dashboard-first simplification

Pros:
- Fastest visible win on the most obviously overloaded page.

Cons:
- High risk of creating a cleaner dashboard that still drifts from the authoritative streaming state model.

#### Option B: Streams-first operational redesign

Pros:
- Best matches current product reality; `/dashboard/streaming` is already the operator cockpit.

Cons:
- Overview polish lands later.

#### Option C: Immediate hard IA split

Pros:
- Cleanest long-term navigation model.

Cons:
- Highest execution risk because channels and recent-events contracts are not mature enough yet.

### Decision

Choose a hybrid `B -> A` path:
- first define shared truth and simplify `Streams + embedded Channels + Builder`
- then rebuild `/dashboard` as a thin overview that reuses the same truth model
- defer a fully separate `Channels` surface until product/data contracts justify it

## Product Goal

Make the authenticated panel feel:
- obvious on first use,
- compact for daily operation,
- trustworthy during live streaming,
- scalable from first stream to many streams without visual chaos.

## Scope

In scope:
- information architecture for `dashboard`, `streams`, `library`, and the current embedded channels flow;
- stream creation, upload, and first-run guidance flows;
- state hierarchy for `running`, `stopped`, `scheduled`, `error`, and `retry`;
- timezone and quota semantics where UI meaning is currently inconsistent;
- a phased implementation plan that preserves existing capabilities while simplifying presentation.

Out of scope:
- backend streaming engine redesign;
- a brand-new user-facing events system;
- a full visual rebrand of marketing pages;
- removal of advanced capabilities such as timeline editing, live editing, retry visibility, or compatibility analysis.

## Architectural Decisions

### ADR-01: Canonical live-state source

Decision:
- `Streams` becomes the authoritative operator surface.
- `Overview` must consume the same derived live-state model used by the streaming page rather than inventing separate status logic.

MVP rule:
- keep `api.streams.list()` as the list source
- keep per-stream `api.streams.status(stream.id)` freshness checks for operational views
- build one shared frontend query adapter/hook, owned in the dashboard/streaming data layer, that overview and streams both consume
- when status freshness is unavailable, show last known state plus a stale/degraded hint instead of fabricating certainty

Why chosen:
- avoids repeating the earlier dashboard/streams drift that already appeared around start/stop state and duration semantics

Consequences:
- overview stays intentionally thin
- any future status improvements happen once, then flow to both surfaces

### ADR-02: Channels route decision

Decision:
- keep Channels embedded inside `Streams` for MVP simplification
- do not create a top-level `Channels` route in the first implementation pass

Why chosen:
- current destination contract does not yet support a richer standalone health surface
- the existing user journey already treats channels as part of stream operation

Consequences:
- navigation stays simpler in the first pass
- a future dedicated `Channels` route remains possible once richer metadata exists

### ADR-03: First-run state model

Decision:
- derive first-run state from real account resources rather than introducing a persisted onboarding engine in the first pass

Derived states:
- no assets -> `Upload your first video`
- assets but no destinations -> `Connect your first channel`
- assets + destinations but no streams -> `Create your first stream`
- has streams but none running -> `Open streams and start your next broadcast`
- has running stream -> `Open live control`

Why chosen:
- simpler to verify
- avoids hidden onboarding state drift

Consequences:
- onboarding becomes deterministic and testable from fixture data
- if richer onboarding is needed later, it can layer on top of this model

### ADR-04: Builder persistence model

Decision:
- the new wizard remains a UI shell over the existing media-collection persistence model for MVP
- first-run users will choose assets directly, but the system may continue creating hidden collections under the hood

Why chosen:
- backend already supports `playlist_id`, `asset_ids`, and collection IDs in `backend/app/schemas/api.py:234-320`
- current builder and live editing rely on collection-oriented structures
- changing the domain model and the UX flow simultaneously would make the project too broad

Consequences:
- UX can be simplified without destabilizing stream creation semantics
- a later domain cleanup may still replace hidden collection persistence with direct asset-first payloads

### ADR-05: Recent-events handling

Decision:
- remove “recent events” from MVP overview scope unless a user-facing source is introduced
- replace it with `attention needed` summaries derived from current stream/runtime state

Why chosen:
- current alert plumbing is admin-oriented, not user-oriented

Consequences:
- overview becomes more honest and more achievable
- no placeholder events block should ship without trustworthy data

### ADR-06: Quota and time semantics

Decision:
- adopt rolling 24-hour semantics end-to-end for quota-facing UI
- rename “daily” usage copy to “last 24 hours” where it reflects quota enforcement

Why chosen:
- matches backend truth already enforced in `backend/app/core/quota.py`
- avoids timezone confusion and apparent quota bugs

Consequences:
- dashboard and streaming copy must change together
- helper utilities should standardize relative vs absolute time treatment

### ADR-07: Primary action policy by stream state

Decision:
- every stream card must expose exactly one primary action and treat secondary/destructive actions separately

Primary action rules:
- `running` -> `Stop`
- `starting` / `stopping` -> disabled progress state
- `scheduled` -> `Edit schedule` as the primary action; `Start now` may exist as a secondary action
- `error` / `retrying` -> `View issue` or `Retry`
- `stopped` -> `Start`

Consequences:
- stream cards become more scannable
- destructive actions move into overflow or a clearly secondary zone

## Target Information Architecture

### Surface 1: Overview

Purpose:
- show current operating state, top risk, and next best action

Rules:
- thin summary only
- must reuse the same live-state adapter as `Streams`
- no duplicate operational logic

Should contain:
- one primary hero block with one of:
  - `No stream yet -> Upload and create your first 24/7 stream`
  - `Live now -> currently live summary`
  - `Needs attention -> issue/retry summary`
- one compact usage summary
- one compact live summary list with top active/attention streams only
- one conditional first-run CTA block

Should not contain:
- duplicate quota cards
- gamification above operational summary
- multiple competing CTA groups
- speculative “recent events” without real user-facing data

### Surface 2: Streams

Purpose:
- primary operator cockpit

Should contain:
- live/scheduled/needs-attention/stopped groupings
- compact cards or rows with:
  - stream name
  - destination
  - status
  - uptime or next schedule
  - primary action
- embedded channel management panel
- logs, live-edit, and advanced details behind secondary surfaces

Should not contain:
- every piece of metadata expanded by default
- ambiguous action hierarchy

### Surface 3: Library

Purpose:
- manage assets and playlists with content readiness first

Should contain:
- upload CTA
- asset readiness state
- search/filter/folder organization
- playlists as secondary organization

Should not contain in the first-run path:
- large blocks of encoding guidance before file selection
- heavy diagnostics before upload success/progress is clear

### Surface 4: Channels

MVP position:
- embedded inside `Streams`, not a standalone route

Future elevation criteria:
- richer health/test metadata exists
- platform labels and validation status become user-trust-critical
- top-level separation improves more than it fragments the workflow

## Acceptance Criteria

1. `Streams` is clearly the authoritative operator surface for live-state truth.
2. `Overview` becomes a thin summary that does not duplicate or contradict stream status logic.
3. The product exposes one deterministic first-run next action based on account state.
4. Stream cards visibly prioritize status, destination, schedule/uptime, and one primary action.
5. Destructive actions no longer compete visually with the primary stream action.
6. The stream creation flow is restructured from a five-tab expert modal into a guided sequence for first-run users.
7. The wizard preserves advanced editing by routing customization behind progressive disclosure.
8. The upload flow starts with file selection and progress, not heavy technical education.
9. Library surfaces prioritize readiness, search, and organization ahead of advanced metadata.
10. Quota-facing usage labels match backend rolling 24-hour semantics, or any intentional difference is explicitly named.
11. Absolute dates become locale-aware on user-facing surfaces where they are currently English-biased.
12. Existing operational capabilities remain reachable: scheduling, retry visibility, logs, live edit, compatibility analysis, and collection-based workflows.

## Delivery Plan

### Phase 0: Shared Truth and Semantic Alignment

1. Implement ADR-backed decisions for:
   - canonical live-state source
   - first-run derivation
   - channels MVP placement
   - builder persistence model
   - quota/time labeling
2. Create a shared frontend truth adapter for stream state used by both Overview and Streams.
3. Standardize time helpers:
   - rolling 24-hour quota labels
   - relative status times
   - locale-aware absolute timestamps
4. Remove or explicitly defer any overview block that lacks a real data source.

### Phase 1: Streams and Embedded Channels Simplification

1. Simplify `frontend/src/app/dashboard/streaming/components/StreamsList.tsx:131-320`.
2. Group streams by operational state:
   - `Live now`
   - `Scheduled`
   - `Needs attention`
   - `Stopped`
3. Apply the primary-action policy by state.
4. Move secondary metadata into expandable details or auxiliary modals.
5. Keep channel management embedded in the operator surface, but simplify its hierarchy and wording.

### Phase 2: Builder, Upload, and Library Simplification

1. Replace the five-tab builder mental model with a guided wizard:
   - Content
   - Channel
   - Schedule
   - Review & Launch
2. Preserve advanced controls behind `Customize` / `Advanced`.
3. Keep the current hidden collection-persistence model unless a separate backend contract change is explicitly approved later.
4. Simplify the upload opening state so file selection and progress come first.
5. Reorder compatibility analysis to appear after upload readiness is understood.
6. Simplify the library landing surface around upload, search, folders, and readiness.

### Phase 3: Thin Overview Rebuild

1. Rebuild `/dashboard` around:
   - one primary operating summary
   - one compact live/attention summary
   - one concise usage block
2. Replace generic quick actions with state-derived next actions.
3. Demote or collapse progression/gamification content.
4. Keep the overview intentionally summary-only; do not reintroduce full operator complexity here.

### Phase 4: Copy, Visual Consistency, and Verification Hardening

1. Normalize CTA vocabulary across surfaces:
   - upload
   - connect
   - create
   - start
   - stop
2. Normalize status chips and explanatory text.
3. Harden tests and manual walkthroughs for fixture states, locale states, and mobile.

## Risks and Mitigations

Risk:
- A prettier dashboard could still be untrustworthy if overview and streams continue using different truth models.
Mitigation:
- Phase 0 must land before overview redesign.

Risk:
- Simplification could hide power-user controls.
Mitigation:
- preserve advanced controls via progressive disclosure rather than deletion

Risk:
- Trying to split Channels into its own product surface too early will broaden scope and invent unsupported data semantics.
Mitigation:
- keep Channels embedded for MVP; revisit only after richer health data exists

Risk:
- Builder simplification could accidentally force a hidden domain-model rewrite.
Mitigation:
- keep the existing collection persistence model in MVP and make any domain cleanup a follow-up project

## Execution Handoff

### Available agent types

- `planner`
- `architect`
- `critic`
- `designer`
- `executor`
- `debugger`
- `test-engineer`
- `verifier`
- `explore`

### Suggested reasoning levels by lane

- `architect`: high
- `designer`: high
- `executor`: high
- `debugger`: high
- `test-engineer`: medium
- `verifier`: high
- `explore`: low

### Ralph path

Recommended sequential order:
1. Phase 0 ADR and truth-model alignment
2. Phase 1 Streams and embedded Channels
3. Phase 2 Builder, Upload, and Library
4. Phase 3 thin Overview
5. Phase 4 polish and verification

### Team path

Do not parallelize before Phase 0 is agreed.

After Phase 0, safe lane split:
- Lane A: semantics and shared truth adapter
- Lane B: streams and embedded channels simplification
- Lane C: builder, upload, and library flow
- Lane D: regression fixtures and verification harness

Shared-file hotspot warning:
- `frontend/src/app/dashboard/streaming/page.tsx`
- `frontend/src/app/dashboard/streaming/components/StreamBuilderModal.tsx`
- `frontend/src/app/dashboard/streaming/hooks/useStreamBuilder.ts`

These should have single-owner coordination or phased ownership to avoid merge conflicts.

### Launch hints

- `ralph`: execute phases in order and do not start visual simplification before Phase 0 decisions are reflected in code/tests.
- `$team`: use one owner for semantics/truth, then parallelize the remaining lanes with a dedicated verifier lane.

### Team verification path

The verifier lane must explicitly confirm:
- dashboard and streams show parity for live-state truth
- quota UI matches `/api/quota` semantics
- stale/unavailable status is rendered honestly
- first-run next-step derivation is deterministic
- locale-aware absolute time formatting works in supported locales
