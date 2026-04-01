# Architecture

High-level system description for the V1 stabilization mission.

## What belongs here
- Major components and how they interact
- Runtime ownership and data-flow invariants
- Product boundaries for V1
- Important constraints workers must preserve

## Mission target
- Ship a simple production baseline for a **one-VPS / Docker Compose** deployment
- Keep the product **copy-first** and avoid introducing heavy always-on transcoding work in runtime paths
- Use **manual plans/tier changes** for V1; do not add Stripe or checkout flows
- Validate locally through **dev auth + local services**; real YouTube ingest is deferred

## Runtime topology

### Control plane
- **Frontend** (`frontend/`) is the user-facing product surface.
- **Backend API** (`backend/app/`) owns auth-bound APIs, quotas, stream definitions, admin actions, scheduler bootstrapping, and runtime reconciliation.
- **Postgres** stores application state: user profiles, assets, folders, playlists, destinations, streams, audit data, quotas, and runtime metadata.
- **Redis** supports rate limiting and shared coordination where configured.

### Execution plane
- **Runner** is the preferred V1 execution surface for real stream processes.
- **Supervisor-managed stream workers** run `python -m app.cli.run_stream <stream_id>` and keep FFmpeg out of the API process.
- **FFmpeg** is the publish engine and should stay low-load via copy-first media wherever assets are already compatible.

## Runtime ownership model

Workers should reason about runtime ownership at a high level as follows:

- **Backend API** owns stream definitions, launch intent, schedule intent, quota decisions, user/admin permissions, and the reconciliation loop.
- **Runner + supervisor** own the actual long-lived process execution surface for managed runtime.
- **DB-backed runtime metadata** is the authoritative shared coordination layer for stream state, lease windows, restart intent, and recovery bookkeeping.
- **Heartbeat signals** tell the backend whether a managed stream still has a healthy execution owner.
- **Restart decisions** for accepted V1 behavior must not be split across multiple conflicting authorities. Workers should preserve one coherent restart story rather than adding overlapping retry systems.

The mission-level goal is not “perfect logs”; it is **one authoritative live/non-live state per stream record** after start, stop, suspension, quota exhaustion, stale heartbeat, or backend restart.

### Upload plane
- **tusd** owns resumable upload transport.
- Backend upload-complete hooks validate assets, extract metadata, and update readiness flags.

## Core product surfaces
- **Auth/account**: login, logout, protected routing, profile settings, admin gate.
- **Library**: upload, folders, search/filter, rename, move, delete safety, validation state, optimize requests.
- **Playlists**: create, inspect, validate, edit ordering, delete with dependency checks.
- **Destinations**: masked RTMPS secrets, enable/disable state, stream association.
- **Streams**: create, schedule, start/stop, quality gate, logs, live edit, status, recovery.
- **Plans/quotas**: manual tiers, quota widgets, over-limit messaging.
- **Admin/manual ops**: suspend/unsuspend, tier changes, alerts, force-stop, audit trail.

## Critical invariants

### Auth and tenancy
- Every user-facing resource is tenant-scoped by `user_id`.
- DEV auth is allowed only for local validation; workers must not turn it into the product contract for real production auth.
- Admin and non-admin behavior must stay explicitly distinct.

### Streaming and runtime
- The V1 acceptance target is **managed runtime**, not silent reliance on manager fallback as the product baseline.
- Starting a stream must fail closed when prerequisites are missing: no enabled destination, incompatible media, quota exhaustion, or suspended user.
- A stream record must always converge to **one authoritative state** after start/stop/restart/suspension/reconciliation.
- Recovery semantics matter more than exact log wording.

### One-VPS storage assumptions
- The approved baseline assumes **shared local disk/volumes** between the backend and runner for uploads, stream artifacts, logs, and supervisor program state.
- Upload validation, playlist building, runtime execution, and log inspection all depend on those shared filesystem paths remaining coherent.
- Workers must preserve the upload -> validate -> ready-for-stream -> runtime-read path and the runner/backend visibility into the same stream/log artifacts.

### Copy-first policy
- Compatible assets should flow through stream launch without unnecessary transcoding.
- If an asset is not copy-ready, the product must make that visible before launch and provide a clear remediation path.
- Do not introduce a heavyweight background transcoding system unless a feature explicitly calls for it.

### Product simplicity
- No Stripe, checkout, or billing-provider work in this mission.
- No Figma/overlay/designer feature expansion.
- No architectural rewrite away from FastAPI + Next.js + runner.

## Important data-flow summaries

### Upload to streamable asset
1. User uploads via Library.
2. tusd stores the file and triggers backend completion hook.
3. Backend validates metadata and compatibility.
4. Library surfaces readiness/warnings.
5. Stream builder or playlist validation consumes that readiness state.

### Stream lifecycle
1. User creates destination(s) and stream definition.
2. Start path validates quotas, destination availability, and media readiness.
3. Managed runtime launches or updates the stream process.
4. Status/log surfaces reflect the same stream record.
5. Reconciler repairs stale or restarted control-plane state.

### Manual operations
1. Admin changes user state or stream state.
2. Backend persists mutation and audit event.
3. User-facing plan/quota/stream surfaces reflect the change quickly.
4. Suspensions and force-stops must not leave ghost live state behind.

### Quota enforcement
- Quota behavior relevant to this mission includes not only static limits like storage or destination count, but also **concurrent streams** and **daily streaming hours**.
- Enforcement must stay coherent across pre-start checks, live runtime behavior, and user-visible/admin-visible surfaces.

## Mission boundaries to preserve
- `3000` is off-limits; mission local frontend baseline is `3100`.
- Keep backend API on `8000`, tusd on `1080`, runner supervisor control on `9001`, postgres on `5432`, redis on `6379`.
- Do not depend on real YouTube ingest or external billing credentials for acceptance.
- Do not touch the unrelated CRM project using port `3000`.
