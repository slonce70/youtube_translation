## Task Statement

Create a consensus-backed implementation plan to make the authenticated dashboard experience simpler, more attractive, and easier to understand for a 24/7 streaming product.

## Desired Outcome

- A refined PRD and test spec for dashboard/streams/library/channels simplification.
- A plan grounded in current codebase constraints and live UX inspection.
- A plan ready for later execution via `ralph` or `team`, without implementing changes yet.

## Known Facts / Evidence

- The current dashboard mixes multiple jobs in one first viewport: overview, quick actions, live controls, usage, checklist, and progression blocks.
- The stream creation flow currently exposes a five-tab expert modal early in the journey.
- The upload flow exposes technical compatibility education too early in the first-run path.
- Frontend daily usage semantics currently differ from backend quota semantics:
  - frontend uses local-midnight-derived usage logic in `frontend/src/app/dashboard/page.tsx`
  - backend enforces a rolling 24-hour window in `backend/app/core/quota.py`
- Timezone infrastructure for scheduling is already structurally sound:
  - frontend resolves and sends user timezone in `frontend/src/lib/api.ts`
  - backend stores and evaluates `schedule_timezone` with `ZoneInfo`
- The current product goal is operational 24/7 live streaming with minimal babysitting, not a generalized media control surface.

External research signals:
- playout.video documents a flow centered on Channels -> Destinations -> Go Live and emphasizes hands-free automation.
- Public 24/7 streaming competitors generally separate operational surfaces such as dashboard, streams, and videos/library.

## Constraints

- This turn is planning only; no feature implementation should be done.
- Existing capabilities must remain reachable after simplification:
  - schedule editing
  - advanced timeline/live editing
  - compatibility analysis
  - channel management
- The plan should preserve a path for power users while simplifying the default path for first-run users.
- Recommendations should fit the current codebase shape rather than requiring a full platform rewrite.

## Unknowns / Open Questions

- Whether quota UI should fully adopt rolling 24-hour semantics or present a different concept with explicit labeling.
- Whether channels should become a top-level navigation item immediately or only after first-pass simplification.
- Whether “plans/pricing” should remain inside authenticated navigation or move out of the primary operating path.

## Likely Codebase Touchpoints

- `frontend/src/app/dashboard/page.tsx`
- `frontend/src/components/QuickActions.tsx`
- `frontend/src/app/dashboard/streaming/page.tsx`
- `frontend/src/app/dashboard/streaming/components/StreamsList.tsx`
- `frontend/src/app/dashboard/streaming/components/StreamBuilderModal.tsx`
- `frontend/src/app/dashboard/streaming/hooks/useStreamBuilder.ts`
- `frontend/src/app/dashboard/library/page.tsx`
- `frontend/src/components/upload/UploadModal.tsx`
- `frontend/src/components/library/AssetCard.tsx`
- `frontend/src/lib/api.ts`
- `backend/app/core/quota.py`
- `backend/app/services/streams/service.py`
- `backend/app/core/stream_schedule.py`
