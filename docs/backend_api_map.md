# Backend API Map (FastAPI)

_Updated: November 4, 2025_

This document summarizes the current FastAPI routing surface for the YouTube Multi-Channel Streaming Platform. It focuses on the publicly exposed `/api` namespace and the admin surface, highlighting key dependencies, important behaviors, and obvious gaps that require follow-up work.

## Overview

- Application entry point: `backend/app/main.py`
- Shared dependencies: `backend/app/api/deps.py`
- Response models: `backend/app/schemas/api.py` and inline Pydantic models per router
- Security primitives: Supabase JWT (`require_user`), HMAC-signed tusd hooks, encrypted stream keys

## Route Matrix

| Router | Prefix | Key Dependencies | Core Responsibilities | Notable Observations |
| ------ | ------ | ---------------- | --------------------- | -------------------- |
| `auth` | `/api/auth` | _None yet (placeholders)_ | Placeholder login/logout/me endpoints for Supabase auth | `login` and `me` return 501 – align with plan item 8 to finalize or remove placeholder flow. |
| `quota` | `/api` | `get_db`, `QuotaEnforcer`, `SubscriptionTierLimits`, HMAC header | Internal tusd quota checks and authenticated quota usage reads | `POST /api/internal/check-quota` expects `X-Tusd-Signature`; lacks network-level enforcement in repo – ensure proxy ACLs exist. |
| `admin` | `/api/admin` | `require_user`, SQLAlchemy models, admin gating | User management, stream monitoring, alert lifecycle, audit logs | Admin check queries `UserProfile`; ensure Supabase metadata sync populates `is_admin`. Pagination parameters currently missing. |
| `assets` | `/api/assets` | `require_user`, `QuotaEnforcer`, `VideoValidator`, tusd webhook | CRUD for uploaded media assets; webhook validates uploads and creates records | `validator` falls back to `None` if ffprobe missing – add startup health check? Background quota updates rely on `QuotaEnforcer`. |
| `playlists` | `/api/playlists` | `require_user`, `PlaylistBuilder`, SQLAlchemy models | CRUD for playlists and playlist items | Ensures asset ownership per item; update/delete endpoints commit entire list – consider optimistic locking. |
| `destinations` | `/api/destinations` | `require_user`, stream-key crypto helpers | Manage RTMPS destinations with encrypted keys | `ensure_destination_allowed` enforces tier/domain rules (see security plan items). |
| `streams` | `/api/streams` | `require_user`, `QuotaEnforcer`, `ffmpeg_manager`, playlist builder | Create/start/stop streams, attach destinations, fetch logs/status | SSE/log endpoints rely on filesystem reads; ensure pruning per plan §4. |
| `metrics` | `/api/metrics` | `get_current_user`, `get_db`, psutil | Report system resource usage and streaming capacity estimates | Collects host metrics; `get_current_user` requires valid Supabase Bearer token. |

## Endpoint Details

### Public API (`/api`)

- `GET /` → service heartbeat (anonymous)
- `GET /health` → liveness check (anonymous)
- `GET /api/metrics/` → system + stream metrics (requires Supabase Bearer token)
- `POST /api/internal/check-quota` → tusd pre-create hook, HMAC optional
- `GET /api/quota/usage` *(in `quota.py`)* → returns tier usage snapshot for authenticated user

### Assets (`/api/assets`)

- `GET /` → list assets scoped by `user_id`
- `POST /` → create asset (quota enforced)
- `POST /upload-complete` → tusd webhook to finalize asset + validation
- `GET /{asset_id}` / `DELETE /{asset_id}` → inspect/delete assets (ensures ownership)

### Playlists (`/api/playlists`)

- `GET /` → list playlists with items
- `POST /` → create playlist; validates asset ownership
- `GET /{playlist_id}` → fetch playlist with eager-loaded items
- `PUT /{playlist_id}` → update metadata/items (full replace)
- `DELETE /{playlist_id}` → remove playlist and items cascade

### Destinations (`/api/destinations`)

- `GET /` → list destinations, returns masked stream keys
- `POST /` → create destination with encrypted key + quota checks
- `GET /{destination_id}` → fetch single destination (masked key)
- `PUT /{destination_id}` → update destination metadata/key
- `DELETE /{destination_id}` → remove destination
- `POST /{destination_id}/test` *(if implemented later)* → **Not present** – plan callout if needed for health checks

### Streams (`/api/streams`)

- `GET /` → list streams for current user
- `POST /` → create stream config (validates playlist & destinations)
- `POST /{stream_id}/start` → check quotas, hydrate playlist, launch FFmpeg via manager
- `POST /{stream_id}/stop` → stop FFmpeg, update status
- `GET /{stream_id}` → fetch stream details (with playlist/destinations)
- `DELETE /{stream_id}` → delete stream + destinations link
- `GET /{stream_id}/status` → returns cached status info
- `GET /{stream_id}/logs` → stream log tail (filesystem read)

### Admin (`/api/admin`)

- `GET /access` → verify admin privileges (used by frontend gate)
- `GET /users` → list users with quotas/usage
- `GET /users/{user_id}` → detailed profile including asset counts
- `POST /users/{user_id}/suspend` / `POST /users/{user_id}/unsuspend`
- `POST /users/{user_id}/tier` → change subscription tier
- `GET /streams` → list active streams with owner metadata
- `POST /streams/{stream_id}/stop` → force stop stream
- `GET /alerts` → list alerts, filterable by status/severity
- `POST /alerts/{alert_id}/resolve` → resolve alert with optional notes
- `GET /actions` → admin audit log listing

## Gaps & Follow-Up

1. `auth` router remains unimplemented – align with plan §8.
2. Pagination for admin listings is absent; large datasets will load entirely.
3. Quota enforcement relies on background tasks (e.g., storage recalculation) – confirm scheduled jobs exist.
4. `metrics` router depends on psutil; container image must include it.
5. Ensure all routers consistently use `require_user` vs `get_current_user` (metrics currently uses different dependency).
6. Documented endpoints should be exported via OpenAPI/Swagger (`plan §6`).

This mapping satisfies Plan §1.1 (“Карта API и маршрутизация”). Update `plan.md` when subsequent verification steps complete.

