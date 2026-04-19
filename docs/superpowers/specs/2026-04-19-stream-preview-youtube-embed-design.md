# Stream Preview Via YouTube Embed Design

**Date:** 2026-04-19

**Goal**

Add a lightweight operator preview to the streaming dashboard so a user can click a live stream card and immediately see what is currently on air, without adding meaningful server load or a new media-processing subsystem.

## Current Context

The streaming UI already shows useful operational metadata: stream state, provider state, progress, health, and the current asset or playlist position. What it does not show is the actual live picture. The product therefore feels less tangible than competing tools where clicking a stream opens a player for the current live output.

The codebase already carries the two key ingredients needed for a low-risk first version:

- the frontend stream payload already includes `provider_status` and `provider_video_id`
- the product already treats YouTube as the primary provider for MVP streaming

The repository also contains early MediaMTX plumbing, but the playback path is not yet exposed through the current reverse proxy and would introduce more infrastructure work than this UX improvement needs.

## Recommended Approach

The first version should use YouTube's existing playback surface rather than introducing an internal live preview transport.

The preview interaction is:

1. the operator opens the streaming page
2. they click a live stream card
3. the card expands inline
4. if `provider_video_id` is available, an embedded YouTube player is shown
5. if `provider_video_id` is not yet available, the card shows a clear pending state instead of a broken player

This approach keeps the feature practical:

- it adds almost no load to the VPS because playback is served by YouTube
- it does not require another FFmpeg process, a lower-bitrate duplicate stream, or a second encoding ladder
- it does not require MediaMTX HLS/WebRTC playback plumbing for MVP
- it delivers the specific UX the user asked for: click a stream and see what is live now

## Why Not MediaMTX First

MediaMTX remains a good second-stage option, especially for lower-latency internal preview. It is not the right first step here.

For this product and deployment shape, MediaMTX playback would require additional work across reverse proxy routing, origin policy, player integration, and possibly container or NAT networking if WebRTC were chosen. That extra complexity is not justified for the immediate user value, because YouTube already has the playback surface and the product already knows the provider video id.

Therefore the correct MVP order is:

1. YouTube embed preview
2. optional MediaMTX HLS fallback later
3. optional MediaMTX WebRTC low-latency preview after that

## UX Design

### Placement

Preview should live inline inside the existing stream card on the streaming page, not in a separate route and not in a modal by default.

This keeps the operational context visible while watching the stream:

- health and incident state
- current progress
- stream actions
- destination/provider labels

The operator should not have to navigate away from the control surface just to confirm what is on air.

### Expansion Behavior

Only the card body should toggle preview. Action buttons such as `Stop`, `Edit schedule`, `Logs`, and menu actions must continue to behave independently and must not open or close the player by accident.

Only one preview may stay open at a time. Opening another stream preview closes the currently open one. This avoids multiple simultaneous embedded players and keeps the page lightweight.

### Player Defaults

The embedded player should:

- start muted
- allow manual unmute
- use a stable responsive aspect ratio
- show a small label that this is `YouTube preview`
- show a small latency hint such as `Preview may lag behind live output by a few seconds`

The interface should feel like an operator tool, not a public viewing page.

## Availability Rules

Preview is considered available when the stream has a usable `provider_video_id`.

For MVP, the preview affordance should be exposed only for streams in a live-like operator state such as `starting` or `running`, but `provider_video_id` is the real gate for rendering the player itself. A stream can be operationally live while YouTube is still catching up with provider metadata, so the design must handle that intermediate state cleanly.

### States

There are three supported preview states:

1. **Ready**
   - `provider_video_id` exists
   - show the embedded YouTube player

2. **Pending**
   - stream is live or starting, but `provider_video_id` is not yet present
   - show a friendly empty-state explaining that YouTube has not exposed the preview link yet

3. **Unavailable**
   - stream is not live and no preview link exists
   - do not expand into a player surface

The important rule is that the interface must never render a broken iframe when the data is not ready.

## Non-Goals

This feature intentionally does **not** include:

- MediaMTX playback routing
- HLS player integration
- WebRTC player integration
- a backend endpoint that proxies or signs preview URLs
- a new preview encoding job
- showing many live players at once
- viewer-facing preview surfaces outside the authenticated operator dashboard

Those are valid future enhancements, but they are outside the scope of this iteration.

## Data And Interface Contract

The design assumes the current stream payload remains the source of truth for preview availability.

The frontend should rely on existing stream fields:

- `provider_status`
- `provider_video_id`
- stream name and destination/provider labels already shown in the card

No new backend API is required if the current page data already includes those fields. If the current page container does not yet pass them all the way into the stream-row component, that is a frontend wiring task, not a backend feature.

The embed URL should be derived on the client from `provider_video_id` in one small utility or component boundary rather than scattered through the page.

## Error Handling

This feature must fail softly.

If the embed cannot be shown, the page should remain a usable control surface. The operator must still be able to start, stop, inspect status, and open logs.

Expected soft-failure cases include:

- YouTube has not exposed `provider_video_id` yet
- the embedded player refuses playback for a specific video
- the provider live state becomes stale while the page is open

The UX response should be a compact inline message, not a page-level failure state.

## Performance Rules

The implementation should explicitly optimize for low overhead:

- no autoplaying previews across the full list
- instantiate only the active preview player
- destroy or unmount the player when the preview closes
- close the active preview when another preview opens

This keeps CPU, memory, and browser noise low on both the client and the server side.

## Testing Strategy

This feature should be protected mainly with frontend tests around behavior, not backend or infrastructure tests.

The minimum test matrix is:

- stream with `provider_video_id` renders preview when expanded
- stream without `provider_video_id` renders the pending empty-state
- opening one stream preview closes another
- clicking control buttons does not toggle preview accidentally
- non-live or preview-unavailable streams do not render a broken player

If the embed URL creation is extracted into a small helper, it should also get a tiny unit test so the final URL shape does not drift.

## Expected Outcome

After this change, the streaming page will feel more concrete and trustworthy:

- operators can verify the live output visually
- the feature matches a familiar competitor interaction pattern
- the implementation stays simple
- server load remains effectively unchanged

That is the right balance for this stage of the product: better visual confidence without turning preview into a second streaming system.
