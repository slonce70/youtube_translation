# YouTube Provider Status PRD And Test Spec

Date: 2026-05-08

## Scope

This is the consensus contract for the YouTube-only provider-status lane. Twitch, generic multi-provider work, and write-scoped YouTube automation are out of scope.

The feature supplements internal runtime truth with official YouTube API truth. It must not replace DB, service, or FFmpeg runtime status as the source of authority for local stream control.

## Official YouTube Grounding

- `liveBroadcasts.list` can return current live broadcasts with `broadcastStatus=active`, `mine=true`, and `part=id,snippet,status,contentDetails`.
- `videos.list(part=liveStreamingDetails, id=...)` can expose `liveStreamingDetails.concurrentViewers`, but only while YouTube provides the value for a live broadcast.
- `liveStreams.list(part=status, id=...)` exposes `status.streamStatus` and `status.healthStatus`.
- YouTube live stream health values are `good`, `ok`, `bad`, and `noData`.
- YouTube defines `good` as no warning-or-worse configuration issues, `ok` as no error issues, `bad` as error-level issues, and `noData` as no health data yet.
- YouTube recommends RTMP/RTMPS ingest, H.264, CBR, keyframes every 2 seconds and not above 4 seconds; RTMPS is preferred for encrypted ingest.

Sources:

- https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.google.com/youtube/v3/live/docs/liveStreams/list
- https://developers.google.com/youtube/v3/live/docs/liveStreams
- https://support.google.com/youtube/answer/2853702

## Product Semantics

- `live`: YouTube has an active broadcast for the linked authenticated channel.
- `offline`: YouTube returns no active broadcast for the linked authenticated channel.
- `stale`: refresh failed, but the app has a prior provider sync timestamp.
- `unknown`: there is no linked provider connection or no usable provider evidence.

Health attention rules:

- `good`: no attention.
- `ok`: no attention unless configuration issues are present.
- `bad`: attention required.
- `noData`: attention required when the local runtime is expected to be live, because YouTube has not confirmed ingest health.
- Any returned configuration issue is attention-worthy and should be counted in UI summaries.

## Acceptance Criteria

- Backend provider status uses only official YouTube Data / Live Streaming API endpoints listed above.
- The default OAuth scope remains `https://www.googleapis.com/auth/youtube.readonly`.
- Provider-backed profile connections and provider-backed destinations expose the same status, viewer, video id, stream status, health status, and issue semantics.
- Raw RTMPS destinations remain supported and are not labeled as broken OAuth/provider connections.
- Frontend does not mark clean `good` or `ok` health as degraded.
- Frontend does mark `bad`, `noData`, and non-empty configuration issue lists as requiring operator attention.
- Concurrent viewers are displayed only when YouTube returns `concurrentViewers`.

## Test Spec

Backend:

- Active broadcast response maps to `provider_status=live`.
- Empty active broadcast response maps to `provider_status=offline`.
- `concurrentViewers` maps to an integer when present and to `null` when absent.
- `status.streamStatus`, `status.healthStatus.status`, and configuration issue `type` values map into provider snapshots.
- Refresh failure with prior sync maps to `stale`; refresh failure without prior sync maps to `unknown`.
- OAuth configuration errors remain non-500 actionable service errors on the start route.

Frontend:

- `live` counts as provider-live; `offline`, `stale`, and `unknown` do not.
- `stale` and `unknown` retain warning badge semantics.
- `good` and clean `ok` do not display ingest degradation.
- `bad`, `noData`, and non-empty issue lists display ingest attention.
- Provider issue count is exactly `provider_health_issues.length`.

Manual / production read-only smoke:

- Check current deployed SHA and health without restarting services.
- Confirm `youtube-backend.service` is active.
- Confirm Docker infra is healthy for `postgres`, `redis`, `tusd`, `frontend`, and `mediamtx`.
- Confirm provider fields are present on `/api/youtube/connections` and `/api/destinations` only when an OAuth-linked provider connection exists.
- Confirm no Twitch copy, routes, or assumptions are added in this lane.

## Current Implementation Note

The code already follows the YouTube-only backend shape through `YoutubeClient`, `YoutubeProviderStatusService`, and provider-aware destination responses. The 2026-05-08 correction is specifically to align frontend health attention semantics with YouTube's documented `good` / `ok` / `bad` / `noData` definitions.
