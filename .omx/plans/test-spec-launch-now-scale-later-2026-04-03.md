# Test Spec: Launch Now, Scale Later

## Purpose

Define the verification gates for the recommended phased rollout:
- Phase 0: one all-in-one node launch
- Phase 0.5: pre-public hardening
- Phase 1: object storage migration
- Phase 2: runner-pool scaling

## Testable Assumptions

1. A single all-in-one node avoids the current local-storage blocker because uploads, backend-side validation, and FFmpeg execution remain colocated.
2. The current repo cannot safely separate backend from the media host before storage abstraction because assets are stored, validated, and prepared as local paths.
3. The current repo cannot safely scale to multiple runner nodes before storage abstraction because assets are stored and validated as local paths.
4. Multi-destination reliability needs an explicit hardening gate because one FFmpeg `tee` process currently serves multiple outputs.

Evidence:
- Local upload volume mounts: `docker/docker-compose.yml:46-50`, `docker/docker-compose.yml:88-92`
- Local path persistence: `backend/app/services/assets/upload_service.py:186-190`
- Backend-side local validation and file resolution: `backend/app/services/assets/upload_service.py:213-307`
- Local path enforcement: `backend/app/services/assets/service.py:440-465`
- Local path use during stream prep: `backend/app/services/streams/helpers.py:44-58`
- Single-process multi-destination output: `backend/app/streaming/ffmpeg_manager.py:762-772`

## Phase 0 Verification Matrix

### Topology deployment

1. Deploy the chosen launch topology.
2. Confirm all required services become healthy.
3. Confirm the media node has writable upload and stream work directories.

Pass condition:
- All services required by the selected launch topology are healthy and reachable.

### Upload flow

1. Upload a known-good H.264/AAC test asset via tusd.
2. Confirm backend creates the asset record.
3. Confirm `storage_path` points to a file on the media node.

Pass condition:
- Upload completes and the asset is playable from the media node without any shared filesystem.

### Single-stream rehearsal

1. Create one destination.
2. Create one stream from one compatible asset.
3. Start the stream and watch logs for several minutes.
4. Stop the stream cleanly.

Pass condition:
- Stream reaches `running`, stays stable for the rehearsal window, and stops without orphaned runtime state.

### Control-plane restart resilience

1. Start one stream.
2. Restart frontend and backend services only.
3. Confirm the active stream continues on the media node.

Pass condition:
- Stream remains alive or recovers without manual media reattachment.

## Phase 0.5 Hardening Matrix

### Multi-destination isolation

1. Configure one stream with multiple destinations.
2. Simulate one failing destination.
3. Observe whether other destinations remain healthy or the stream aborts.

Pass condition:
- Behavior is explicitly validated and documented.
- Public launch is blocked until the chosen failure policy is proven acceptable.

### Disk pressure and node failure runbooks

1. Simulate low disk on the media node.
2. Simulate runner unavailability.
3. Validate that alerts, logs, and operator actions are documented.

Pass condition:
- Operators can follow documented steps without guessing.

## Phase 1 Verification Matrix

### Object storage ingest

1. Upload a new asset to S3/MinIO-backed storage.
2. Persist the object-backed reference in the asset model.
3. Confirm metadata and validation still succeed.

Pass condition:
- The asset is no longer coupled to permanent local-only origin storage.

### Runner cache hydration

1. Start a stream on a runner with no local copy.
2. Confirm the runner downloads or hydrates the asset locally.
3. Restart the same stream and confirm cache reuse behavior.

Pass condition:
- Playback works on a runner that did not receive the original upload directly.

## Phase 2 Verification Matrix

### Multi-runner placement

1. Register two runner nodes.
2. Start several streams.
3. Confirm streams are assigned to one specific runner each.

Pass condition:
- Placement uses explicit runner selection instead of accidental locality.

### Failure containment

1. Stop one runner node while multiple streams are active.
2. Observe affected and unaffected streams.
3. Confirm only streams assigned to the failed runner are impacted.

Pass condition:
- No cross-node cascade.

### Scheduler safety

1. Mark one runner unhealthy.
2. Start a new stream.
3. Confirm the unhealthy runner is not chosen.

Pass condition:
- Placement avoids unhealthy runners.

## Observability Checks

At every phase verify:
- service health endpoints
- stream logs and restart metadata
- disk usage visibility
- runner health visibility
- destination-specific failure visibility for multi-destination streams

## Exit Gates

### Launch gate

Required before the first public or customer-visible launch:
- Phase 0 complete
- Phase 0.5 multi-destination behavior explicitly accepted or fixed
- operator runbooks published

### Scale gate

Required before adding a second runner node:
- Phase 1 complete
- storage decoupling verified
- runner cache strategy verified

### Pool gate

Required before claiming horizontal media scaling:
- Phase 2 complete
- failure containment verified
- unhealthy-runner avoidance verified
