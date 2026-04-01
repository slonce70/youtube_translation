# Research Brief: youtube_translation discovery contour

Дата: 2026-03-29
Контекст: Paperclip issue `CRM-13`

## Executive summary

`youtube_translation` already has a credible MVP for manual RTMPS streaming:

- FastAPI + async SQLAlchemy backend with quotas, tusd uploads, stream scheduling, metrics, and FFmpeg runtime orchestration
- Next.js dashboard with stream builder, schedule controls, destination management, and limited live queue editing
- local runtime modes for `manager`, `supervisor`, and `systemd`

The main gap is that the product is still centered on **manual RTMPS destinations + stream key storage**, while the market and YouTube platform constraints now favor a clearer split between:

1. creator-facing YouTube lifecycle management
2. 24/7 playout operations
3. operator tooling for long-running streams

The most important execution takeaway is:

- keep RTMPS fallback
- add a YouTube-managed control plane beside it
- make runtime capability differences explicit in the product
- treat `>12h` streams as a segmentation/archive problem, not only as a scheduler problem

## Repo/context audit

### What already exists

- Stream CRUD, schedule, start/stop, logs, websocket status, and live queue append exist in `backend/app/api/routes/streams.py`.
- `StreamService` already supports playlist/assets/collection-based streams, scheduling metadata, and live config updates in `backend/app/services/streams/service.py`.
- `StreamControlService` already handles three runtime families:
  - in-process FFmpeg manager
  - `supervisor`
  - `systemd`
- Hot-swap queue replacement exists in `backend/app/streaming/hot_swap.py`.
- Frontend streaming UX already includes:
  - builder flow
  - destination selection
  - schedule controls
  - live editor modal for queue operations

### Architectural strengths

- Good separation between CRUD/config concerns and runtime control concerns.
- Quota enforcement is already centralized, including destination restrictions and quality checks.
- tusd + validation layer is a solid baseline for large-file ingest.
- Scheduler/runtime split is a good foundation for future YouTube lifecycle hooks.

### Structural product gaps visible in code

1. The destination model is still manual RTMPS only.
   `Destination` stores `rtmps_url` and encrypted `stream_key_encrypted`, but there is no YouTube OAuth, channel entity, or broadcast binding model in `backend/app/models/database.py`.

2. Live editing is runtime-dependent, but the product surface is only partially explicit about that.
   `StreamControlService.enqueue_hot_swap()` rejects hot swapping for `systemd` and `supervisor`, while in-process runtime supports it.

3. Multi-destination fan-out increases runtime cost.
   In `backend/app/streaming/ffmpeg_manager.py`, copy mode is disabled when there is more than one destination, which means multichannel output can force re-encode behavior and change the resource model for 24/7 operations.

4. There is still no first-class YouTube lifecycle layer.
   No current backend router or schema handles:
   - OAuth connect
   - channel sync
   - `liveBroadcast` / `liveStream` provisioning
   - transition state sync
   - archive / VOD metadata

5. Destination diagnostics are thin.
   `docs/backend_api_map.md` explicitly notes that a destination health-check endpoint is not present yet.

## YouTube / platform constraints

These constraints were re-checked against current official Google/YouTube docs on 2026-03-29.

### 1. YouTube-managed live flow is lifecycle-based, not key-based

Official docs still model live streaming around:

- `liveBroadcast`
- `liveStream`
- `liveBroadcasts.bind`
- `liveBroadcasts.transition`

Important operational implications:

- a broadcast should only transition once the associated stream is actually receiving data
- `status.streamStatus == active` is the key readiness signal before moving to `testing`/`live`
- `enableAutoStart` and `enableAutoStop` are part of the broadcast lifecycle, not a local-only scheduler concern

This means the current product can keep manual RTMPS, but serious YouTube-native control will require a distinct backend service layer.

### 2. RTMPS ingestion has concrete transport requirements

The current product default of `rtmps://a.rtmp.youtube.com/live2` matches the official YouTube RTMPS guidance, but official docs also require:

- `rtmps` protocol
- correct YouTube ingestion endpoint
- port `443`
- SNI in the TLS handshake

This matters for production runners and for any future destination test endpoint.

### 3. Quota is a real product constraint, not just an integration detail

YouTube Data API projects still default to **10,000 quota units per day**.

Two immediate implications:

- channel sync and lifecycle polling need throttling/backoff
- product UX should avoid naive refresh-triggered resyncs

Low-cost methods like `channels.list` are cheap, but live lifecycle polling can still become noisy if tied to every dashboard load.

### 4. Long live streams remain awkward for archive/DVR behavior

Current YouTube Help pages still state:

- streams under 12 hours can be auto-archived
- streams over 12 hours may not be captured at all
- DVR rewind behavior may be limited or unavailable for very long streams

So for a 24/7 product, the platform-safe framing is:

- YouTube is the distribution surface
- local segmentation/archive strategy must remain under our control

## Competitor / UX observations

### Restream

What stands out from current product/help pages:

- scheduled pre-recorded events auto-start even when the operator is offline
- event-post UX for YouTube/Facebook/LinkedIn is part of the scheduling surface
- backup streaming exists, but Restream explicitly warns that streaming continuously for more than 24 hours is not guaranteed on a single server session

Product lesson:

- users expect easy simulive scheduling and social event creation
- but they also tolerate platform/runtime caveats if those caveats are explicit

### StreamYard

Current positioning is strongest around:

- browser-based live studio
- guest-friendly workflow
- paid multistreaming
- automatic pre-recorded streaming

Important caveat from their help docs:

- scheduling is supported for YouTube and some social platforms
- scheduling is not available for custom RTMP destinations

Product lesson:

- simple operator UX beats raw flexibility for many customers
- a polished “go live later” flow is competitively important even before deep YouTube lifecycle support ships

### Castr

Castr’s feature surface is closer to the long-run 24/7 playout problem:

- 24x7 schedule/planning
- loop mode
- add live input into playout
- multistream
- backup ingest
- live clipping
- API surface

Product lesson:

- the market expects 24/7 playout to be more than a playlist with a start button
- operators expect schedule editing, redundancy, clipping/highlights, and external control hooks

## Biggest technical unknowns

### Unknown 1. True cost envelope for multi-destination 24/7 fan-out

The codebase markets “no transcoding / copy-first” well, but the runtime currently disables copy mode when more than one destination is active. That may materially reduce the attractive unit economics for multi-channel plans.

What to validate next:

- CPU and bandwidth profile for 1, 2, 4, and 8 destinations
- whether a relay/fan-out layer is needed
- whether pricing/plan copy currently over-promises efficient multi-channel behavior

### Unknown 2. Capability matrix across runtime modes

Today the product has mixed runtime semantics:

- in-process runtime can hot-swap queue state
- managed runtimes are safer for persistence
- managed runtimes give up some live-control functionality

What to validate next:

- exact command matrix per runtime
- whether restart-based degradation is acceptable UX
- whether UI needs runtime badges before broader launch

### Unknown 3. Best first YouTube-native slice

There are two realistic first moves:

1. OAuth + channel sync + destination creation assist
2. full broadcast provision/bind/transition flow

Unknown:

- which slice delivers the highest user value with the lowest operational risk
- whether early customers care more about “connect my channel” or “run the entire event from one dashboard”

### Unknown 4. Archive strategy for 24/7 streams

Because YouTube archival remains unreliable beyond 12 hours, the product needs a local stance on:

- segmented archives
- clip/highlight markers
- metadata handoff to VOD

Without this, 24/7 becomes operationally viable but editorially weak.

## Recommendations for execution

### P0: make the current runtime behavior honest and operator-friendly

- Add a runtime capability matrix response from backend.
- Surface in UI when live edits require restart or are unavailable.
- Add destination connectivity/health testing before “go live”.

Why first:

- lowest implementation risk
- immediate UX trust gain
- reduces operator confusion before bigger platform work lands

### P1: ship a YouTube connection layer beside manual RTMPS

- OAuth web-server flow with offline refresh token handling
- channel sync
- channel status visibility
- optional assistive creation of manual RTMPS destinations from connected channels

Why this order:

- lets the product become “YouTube-aware” before it becomes fully lifecycle-managed
- keeps manual fallback intact

### P2: ship YouTube-managed broadcast provisioning for one stream path

- create/bind broadcast + stream
- sync lifecycle state
- expose provisioning errors clearly
- connect scheduled start/stop with transition hooks

Why after connection layer:

- avoids blending auth, channel sync, and lifecycle orchestration into one risky release

### P3: treat long-run operations as segmentation + recovery

- segment markers
- local archive policy
- backup ingest / recovery playbook
- restart-aware operator timeline

Why:

- this is the real answer to 24/7 streaming, not only bigger schedulers

## Suggested near-term ticket sequence

1. Capability matrix + UI surfacing for runtime limitations
2. Destination test / ingest validation endpoint
3. YouTube OAuth + channel sync
4. YouTube live binding model + provisioning service
5. Segment markers and archive policy
6. Performance profiling for multi-destination fan-out

## Sources

### Internal repo sources

- `backend/app/api/routes/streams.py`
- `backend/app/services/streams/service.py`
- `backend/app/services/streams/control.py`
- `backend/app/streaming/ffmpeg_manager.py`
- `backend/app/streaming/hot_swap.py`
- `backend/app/models/database.py`
- `frontend/src/lib/api.ts`
- `frontend/src/app/dashboard/streaming/components/StreamBuilderModal.tsx`
- `frontend/src/app/dashboard/streaming/components/LiveEditorModal.tsx`
- `docs/backend_api_map.md`
- `docs/operations/first_stream_checklist.md`
- `docs/YOUTUBE_NEXT_WAVE_TECH_DESIGN.md`

### External sources

- YouTube Live Streaming API: Life of a Broadcast
  https://developers.google.com/youtube/v3/live/life-of-a-broadcast
- YouTube Live Streaming API: Delivering Live YouTube Content via RTMPS
  https://developers.google.com/youtube/v3/live/guides/rtmps-ingestion
- YouTube Data API: Quota Calculator
  https://developers.google.com/youtube/v3/determine_quota_cost
- YouTube Data API: Channels list
  https://developers.google.com/youtube/v3/docs/channels/list
- YouTube Data API: OAuth for server-side web apps
  https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- YouTube Help: Archive live streams
  https://support.google.com/youtube/answer/6247592?hl=en
- YouTube Help: Turn on DVR on live streams
  https://support.google.com/youtube/answer/9296823?hl=en
- Restream Help: Schedule your video as a pre-recorded event
  https://support.restream.io/en/articles/2715850-schedule-your-video-as-a-pre-recorded-event
- Restream Help: Set up a backup stream
  https://support.restream.io/en/articles/2014602-set-up-a-backup-stream
- StreamYard Help: Pre-recorded Streaming
  https://support.streamyard.com/hc/en-us/articles/4404258051732-Pre-recorded-Streaming
- StreamYard Help: How to schedule a stream?
  https://support.streamyard.com/hc/en-us/articles/34278484161556-How-to-schedule-a-stream
- StreamYard Help: How to Multi-stream
  https://support.streamyard.com/hc/en-us/articles/360045622851-How-to-Multi-stream
- Castr Features
  https://castr.com/features
