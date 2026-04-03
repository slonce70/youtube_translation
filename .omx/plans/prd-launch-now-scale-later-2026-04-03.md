# PRD: Launch Now, Scale Later

## Requirements Summary

Deliver a production-ish deployment path that can be launched and tested soon without solving distributed media storage first, while preserving a clean migration path toward shared object storage and multi-runner scaling later.

Grounding facts:
- Uploads are currently local-disk bound: backend mounts `../backend/uploads:/app/uploads` and tusd writes to `-upload-dir /app/uploads` in `docker/docker-compose.yml:46-50` and `docker/docker-compose.yml:88-92`.
- Asset creation stores a concrete filesystem `storage_path` and resolves uploads under `settings.upload_dir` in `backend/app/services/assets/upload_service.py:186-190` and `backend/app/services/assets/upload_service.py:295-307`.
- Asset access currently requires `storage_path` to remain inside the user upload directory and often exist on disk in `backend/app/services/assets/service.py:440-465`.
- Stream payload construction expects the asset file to exist locally when building a playable path in `backend/app/services/streams/helpers.py:44-58`.
- The repo already separates control-plane and runner execution-plane conceptually in `docs/ARCHITECTURE.md:24-60` and `docs/operations/supervisor.md:14-18`.
- The repo already anticipates S3-compatible object storage and multi-node scaling later in `docs/ARCHITECTURE.md:251-275` and `docs/ARCHITECTURE.md:402-407`.
- MediaMTX is documented as optional later-stage media-plane, not first-step mandatory complexity, in `docs/operations/mediamtx.md:64-90`.
- Multi-destination streaming currently uses one FFmpeg `tee` process per stream in `backend/app/streaming/ffmpeg_manager.py:762-772`.

## Scope

In scope:
- Define the simplest launchable topology for early production-like testing.
- Define a migration path that removes the local-disk blocker before multi-runner scaling.
- Define the minimum reliability hardening required before public usage.

Out of scope for the first launch tranche:
- Kubernetes.
- NFS/shared filesystem as the primary media strategy.
- Immediate multi-runner scheduling.
- Immediate MediaMTX-first redesign.

## Acceptance Criteria

1. The approved tranche-one deployment target is one all-in-one node, with explicit rationale for why an early backend/media split is currently unsafe.
2. The launch recommendation avoids any requirement for shared media storage across multiple runner nodes.
3. The plan explicitly preserves the repo's current local-path assumptions for the first launch and names the exact code areas that make this necessary.
4. The plan includes a concrete second phase that migrates uploads from local disk to S3-compatible object storage before any multi-runner pool work begins.
5. The plan explicitly calls out the current multi-destination `tee` failure-isolation risk and treats it as a pre-public-launch hardening item.
6. The plan includes verification gates for:
   - first launch on a single media node,
   - storage migration readiness,
   - later multi-runner readiness.
7. The plan includes a clear “do not do yet” list to prevent premature complexity.

## RALPLAN-DR Summary

### Principles

1. Launchability beats elegance for tranche one.
2. Storage must be decoupled before compute can scale horizontally.
3. Control-plane and execution-plane should remain separate even if both still fit on one box initially.
4. Failure isolation should improve monotonically with each phase; do not add scale paths that weaken it.
5. Media-plane complexity should be introduced only when it solves an observed bottleneck.

### Decision Drivers

1. Minimize time-to-first-stable-launch.
2. Remove the current local-disk architectural lock-in without forcing a full distributed rewrite today.
3. Preserve no-transcode / copy-first economics while improving operational safety.

### Viable Options

#### Option A: One all-in-one server now

Approach:
- Deploy frontend, backend, Postgres, Redis, tusd, runner, and local uploads on one machine.

Pros:
- Fastest path to a working production-ish environment.
- Lowest operational complexity.
- Matches the current repo assumptions almost exactly.

Cons:
- One host failure drops everything.
- Upload I/O, API, DB, and media execution compete for the same box.
- Still no path to add runner nodes until storage is abstracted.

#### Option B: Partial two-node split now, object storage later

Approach:
- Server 1 hosts frontend and optional supporting control services.
- Server 2 hosts backend API, tusd, runner, FFmpeg, and local media disk.
- Keep backend colocated with uploads because current upload finalization and stream prep still require local file access.
- Migrate uploads to S3/MinIO before adding more runner nodes.

Pros:
- Preserves simple local-file execution where uploads, validation, and FFmpeg live together.
- Allows frontend and some lighter control surfaces to move off the media box early if needed.
- Keeps the later migration path clean: storage decoupling becomes the next step, not a prerequisite to launch.

Cons:
- Backend is still attached to the media node, so control-plane separation remains partial.
- Still not true HA.
- Media-node failure still stops active streams.

#### Option C: Immediate object storage + multi-runner

Approach:
- Add MinIO/S3 upload path, asset locator abstraction, local caching, and runner placement before first launch.

Pros:
- Cleanest long-term architecture.
- Unlocks true runner scaling immediately.

Cons:
- Highest delivery risk and implementation scope.
- Requires storage, caching, placement, and failure-mode work before the first real launch.
- Violates the launch-soon constraint.

### Recommendation

Choose **Option A** for the first production-like launch. It is the only option that fully respects the current codebase without introducing hidden distributed-file assumptions, because backend upload finalization, validation, thumbnail generation, and stream prep all still expect local media access. Option B becomes viable only as a partial split where backend remains on the media node until storage is decoupled.

## Plan

### Phase 0: Launchable topology

Target:
- Recommended: one all-in-one server for the first public or customer-visible launch.
- Acceptable follow-on variant before object storage: a partial two-node split where backend stays on the media node and only frontend/control surfaces move away.

Recommended topology:
- Server 1: `frontend`, `backend`, `postgres`, `redis`, `tusd`, `runner`, `ffmpeg`, local media disk`.

Optional intermediate topology after the first stable launch:
- Server 1: `frontend` and optional reverse proxy.
- Server 2: `backend`, `tusd`, `runner`, `ffmpeg`, local media disk`, with remote `postgres` / `redis` only if the team explicitly wants that operational split.

Why this works now:
- It respects the current local-path assumptions in `backend/app/services/assets/upload_service.py:186-190`, `backend/app/services/assets/service.py:440-465`, and `backend/app/services/streams/helpers.py:44-58`.
- It also respects backend-side upload finalization and local validation in `backend/app/services/assets/upload_service.py:213-229` and `backend/app/services/assets/upload_service.py:232-307`, which still require local file access on the backend host.
- It avoids distributed file access entirely for tranche one.
- It preserves the current execution model while postponing the backend/media split until storage decoupling makes it safe.

### Phase 0.5: Mandatory hardening before public launch

1. Fix or explicitly gate multi-destination failure isolation.
   - Current risk: one FFmpeg `tee` process drives multiple destinations in `backend/app/streaming/ffmpeg_manager.py:762-772`.
   - Decision: implement either `tee` failure policy hardening for partial destination failure or explicitly defer multi-destination public usage until per-destination behavior is verified.
2. Freeze the supported launch topology in docs and env examples.
   - Explicitly document that backend must stay colocated with uploads until the storage model is changed.
3. Add production-ish runbooks for:
   - node restart,
   - failed stream triage,
   - disk pressure,
   - upload validation failures.

### Deferred Until After Phase 1

Do not do these yet:
- Do not add a multi-runner rollout before object storage becomes the canonical media source.
- Do not split backend away from the media host before storage decoupling removes local-file assumptions.
- Do not introduce a MediaMTX-first redesign before a real relay or observability bottleneck is proven.

### Phase 1: Storage decoupling

Do this before adding a second runner node.

1. Replace direct local-disk asset assumptions with an asset location model.
   - Preserve local cache support.
   - Allow asset origin to be an object-storage key instead of a permanent local absolute path.
2. Move upload ingest from local `filestore` semantics to S3-compatible storage.
3. Update asset validation and stream preparation so runners can:
   - stream from local cache when present,
   - fetch to a local work dir when not present.
4. Keep object storage as the system of record; treat local disk as cache, not canonical storage.

### Phase 2: Runner-pool scaling

Only after Phase 1 is verified:

1. Introduce runner registration and capacity metadata:
   - active stream count,
   - estimated outbound bitrate sum,
   - free disk,
   - runner health.
2. Place each new stream on a single chosen runner node.
3. Retain lease/heartbeat ownership per stream.
4. Add “warm cache” behavior for recently used media assets.

### Phase 3: Optional media-plane expansion

Only if traffic justifies it:

1. Introduce MediaMTX as relay/observability layer, following `docs/operations/mediamtx.md:64-90`.
2. Keep backend as orchestration plane and runner as execution plane.
3. Use MediaMTX only when relay/fan-out visibility or transport separation becomes a real bottleneck.

## Risks and Mitigations

Risk:
- Single media node remains a failure domain in tranche one.
Mitigation:
- Accept this temporarily, document it explicitly, and delay multi-node only until object storage lands.

Risk:
- Multi-destination `tee` failure can still take down the whole stream.
Mitigation:
- Treat destination failure isolation as a mandatory pre-public hardening item; do not market multi-destination reliability until behavior is verified.

Risk:
- Asset model changes touch ingest, asset access, and stream prep paths.
Mitigation:
- Introduce storage abstraction before scheduler work; migrate in one seam rather than mixing scheduler and storage changes together.

Risk:
- Premature MediaMTX adoption could expand scope without solving the primary blocker.
Mitigation:
- Keep MediaMTX as phase 3, not phase 1.

## Verification Steps

### For Phase 0 launch readiness

1. Deploy the recommended all-in-one launch topology.
2. Upload an asset through tusd and confirm it lands on the media node.
3. Start one stream and confirm it runs without requiring shared filesystem access.
4. Restart frontend/API services and confirm the active stream remains alive.
5. Run the repo verification gate plus one real rehearsal stream.

### For Phase 1 storage readiness

1. Upload an asset to S3/MinIO and persist an object-storage-backed asset reference.
2. Start a stream on a runner with an empty local cache.
3. Confirm the runner fetches or hydrates the asset locally before playback.
4. Repeat stream start on the same runner and confirm cache reuse.

### For Phase 2 runner-pool readiness

1. Register at least two runner nodes.
2. Start multiple streams and confirm placement chooses one runner per stream.
3. Take one runner offline and confirm only streams pinned to that runner are impacted.
4. Confirm no new stream is scheduled onto an unhealthy runner.

## ADR

### Decision

Launch first on a single all-in-one node, then migrate to object storage before attempting runner-pool scaling or deeper control-plane/media-plane separation.

### Drivers

- Current code requires local file presence for upload resolution, validation, thumbnail generation, asset access, and stream payload building.
- Launch speed matters more than immediate horizontal media scaling.
- The repo already has a clean architectural path toward storage decoupling and multi-node runtime ownership.

### Alternatives Considered

- Partial two-node split with backend still colocated to media.
- Immediate S3/MinIO + multi-runner.
- NFS/shared filesystem.
- Immediate MediaMTX-first redesign.

### Why Chosen

This path preserves what already works, avoids distributed storage complexity too early, and creates the smallest safe sequence: launch on one node -> storage decouple -> split backend/media when safe -> runner scale.

### Consequences

- The first launch is operationally simple but not HA.
- One node remains both the control and media bottleneck until storage decoupling lands.
- Storage decoupling becomes the single most important enabling project after initial launch.

### Follow-ups

1. Accept the first launch target as one all-in-one node unless a frontend-only split is explicitly required.
2. Prioritize destination failure isolation hardening before public launch.
3. Design the storage abstraction seam before touching multi-runner placement.

## Available-Agent-Types Roster

- `architect`: system boundaries, rollout sequencing, storage/runtime tradeoffs.
- `executor`: implementation of storage abstraction, deployment wiring, and runtime fixes.
- `debugger`: production issue diagnosis, node-specific failures, startup/runtime regressions.
- `test-engineer`: verification strategy, rehearsal scripts, rollout gate hardening.
- `verifier`: completion evidence, environment checks, launch-readiness confirmation.
- `critic`: read-only quality gate for plan or rollout changes.
- `dependency-expert`: S3/MinIO/tusd integration evaluation and SDK tradeoffs.
- `writer`: deployment docs, runbooks, operator guidance.
- `git-master`: commit hygiene and release branch preparation if needed.

## Follow-up Staffing Guidance

### Ralph Path

Recommended lane ownership:
- `architect` at medium reasoning: confirm final topology and storage-migration seam before edits start.
- `executor` at high reasoning: implement Phase 0.5 hardening and Phase 1 storage abstraction incrementally.
- `test-engineer` at medium reasoning: define rehearsal and gate coverage while implementation is in flight.
- `verifier` at high reasoning: run the final launch-readiness evidence pass before completion.

Why this lane exists:
- Ralph is best when one owner should carry sequencing, verification, and stop/go judgment end to end.

### Team Path

Recommended parallel lanes:
- Lane 1, `executor` at high reasoning: destination failure-isolation hardening and runtime-path changes.
- Lane 2, `executor` at high reasoning: storage abstraction and object-storage-backed asset model seam.
- Lane 3, `test-engineer` at medium reasoning: rollout gates, rehearsal automation, and regression coverage.
- Lane 4, `writer` at medium reasoning: deployment docs, runbooks, and operator playbooks.
- Lane 5, `verifier` at high reasoning: evidence collection across topology, upload, stream rehearsal, and failure drills.

Why this lane split exists:
- It keeps write scopes clearer and separates architecture-sensitive runtime work from verification and operationalization.

## Launch Hints

Ralph-oriented handoff:

```bash
$ralph "Execute /Users/trend/Documents/Work/youtube_translation/.omx/plans/prd-launch-now-scale-later-2026-04-03.md and /Users/trend/Documents/Work/youtube_translation/.omx/plans/test-spec-launch-now-scale-later-2026-04-03.md. Prioritize Phase 0.5 tee failure-isolation hardening before any storage migration work."
```

Team-oriented handoff:

```bash
$team "Execute /Users/trend/Documents/Work/youtube_translation/.omx/plans/prd-launch-now-scale-later-2026-04-03.md using parallel lanes for runtime hardening, storage abstraction, verification, and runbooks."
```

```bash
omx team "Execute /Users/trend/Documents/Work/youtube_translation/.omx/plans/prd-launch-now-scale-later-2026-04-03.md using parallel lanes for runtime hardening, storage abstraction, verification, and runbooks."
```

## Team Verification Path

The team should prove these before shutdown:
- Phase 0 topology boots cleanly on one all-in-one node.
- Upload -> validation -> asset persistence -> stream start works without shared filesystem assumptions.
- Multi-destination failure behavior is either hardened or explicitly gated from public use.
- Runbooks cover node restart, disk pressure, failed uploads, and failed streams.

After team shutdown, Ralph or the final verifier should confirm:
- launch gate items in the paired test spec are all green,
- no hidden dependency on cross-node local files remains,
- the next step is clearly either “launch on one node” or “begin Phase 1 storage migration,” not both at once.

## Architect Review Notes

### Steelman Counterargument

The strongest argument against the favored all-in-one launch is that it can harden the wrong operational habits: teams may postpone storage decoupling, accept single-node coupling as "good enough", and then face a riskier migration later when real users and real media volume already depend on the local-disk layout.

### Tradeoff Tension

- Tension 1: launch speed now vs migration cost later
- Tension 2: respecting current local-path code assumptions vs preserving a clean separation between control-plane and media-plane
- Tension 3: low operational complexity now vs earlier exposure to real multi-node failure domains

### Synthesis

The all-in-one first step is architecturally acceptable only if it is treated as an explicit tranche, not as the end-state:
- do not promise horizontal media scaling before storage decoupling is done
- do not split backend away from the media host while `storage_path` still encodes local file semantics
- treat Phase 1 object-storage work as the mandatory next architecture project, not a "nice to have"

## Available-Agent-Types Roster

- `architect`: deployment boundaries, topology decisions, failure domains
- `executor`: infrastructure and application implementation work
- `test-engineer`: rollout verification, rehearsal matrix, regression coverage
- `verifier`: post-change proof and go/no-go evidence
- `writer`: ops docs, runbooks, migration notes
- `debugger`: runtime triage if deployment or stream startup fails
- `dependency-expert`: object storage / tusd backend integration research

## Follow-up Staffing Guidance

### Ralph path

Recommended roles:
- `executor` (high): implement the chosen launch topology and first hardening changes
- `test-engineer` (medium): codify rollout checks and rehearsal coverage
- `verifier` (high): prove launch readiness and record evidence
- `writer` (medium): document topology, runbooks, and migration notes

Why this works:
- The near-term problem is sequencing and correctness, not parallel swarm breadth.

Launch hint:
- `ralph implement the approved launch-now-scale-later plan from .omx/plans/prd-launch-now-scale-later-2026-04-03.md and validate against .omx/plans/test-spec-launch-now-scale-later-2026-04-03.md`

### Team path

Recommended lanes:
- Lane 1 `architect` (high): finalize topology and rollout boundaries
- Lane 2 `executor` (high): launch-topology and config changes
- Lane 3 `executor` (high): storage abstraction design seam
- Lane 4 `test-engineer` (medium): rollout and rehearsal checks
- Lane 5 `writer` (medium): docs and ops runbooks
- Lane 6 `verifier` (high): final cross-lane validation

Why each lane exists:
- Topology and storage abstraction are related but separable, but backend/media separation must wait on storage abstraction.
- Verification and runbooks should not block code-path design.

Launch hints:
- `omx team "Implement phase-0 launch topology and readiness hardening from .omx/plans/prd-launch-now-scale-later-2026-04-03.md"`
- `$team implement the approved phase-0 and phase-0.5 work from .omx/plans/prd-launch-now-scale-later-2026-04-03.md`

Team verification path:
- Team proves topology deployability, upload-to-media-node flow, single-stream rehearsal, and destination-failure test coverage.
- Ralph or verifier proves final end-to-end readiness, residual risks, and rollback notes after team shutdown.

## Applied Review Improvements

- Corrected Phase 0 verification to match the approved all-in-one launch recommendation.
- Added explicit architect steelman, tradeoff tensions, and synthesis notes to prevent accidental end-state drift.
- Explicitly placed MediaMTX in a later phase instead of the launch path.
- Elevated multi-destination `tee` failure isolation to a pre-public hardening requirement.
- Separated storage decoupling from scheduler work so the roadmap stays reversible and bounded.
