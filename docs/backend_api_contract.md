# Backend API Contract Reference

_Updated: November 4, 2025_

This reference captures the current request/response contracts for the FastAPI backend. It is derived from the routers in `backend/app/api/routes/` and the Pydantic schemas in `backend/app/schemas/api.py`. Use it alongside `docs/backend_api_map.md` when building client integrations or automated tests.

## Conventions

- **Auth**: Unless stated otherwise the endpoint requires a Supabase Bearer token and uses `require_user` for tenant scoping. Admin endpoints additionally require `is_admin=True` in `UserProfile`.
- **Status codes**: Only explicitly coded statuses are listed; implicit 422 validation errors are omitted.
- **Models**: Response schema names refer to classes in `backend/app/schemas/api.py` unless marked as "dict".

## Auth Router (`/api/auth`)

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `POST` | `/api/auth/login` | None | `LoginRequest` (`email`, `password`) | `501` + JSON error | Placeholder; returns 501 until Supabase auth is implemented (plan §8). |
| `POST` | `/api/auth/logout` | None | — | `{ "message": "Logged out successfully" }` | Stub for future logout integration. |
| `GET` | `/api/auth/me` | None | — | `501` + JSON error | Placeholder for current-user lookup. |

## Quota Router (`/api` prefix)

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `POST` | `/api/internal/check-quota` | HMAC header (`X-Tusd-Signature`) | `QuotaCheckRequest` (`user_id`, `file_size`) | `QuotaCheckResponse` | Called by tusd pre-create hook; optional HMAC enforced if `TUSD_HMAC_SECRET` set. Returns 403 on signature issues, 422 on validation errors, 503 on internal failure. |
| `GET` | `/api/quota` | ⚠️ Query param `user_id` | `user_id` query parameter | `QuotaUsageResponse` | TODO in code: replace explicit `user_id` param with JWT-derived subject. Returns 404 when profile absent. |

## Admin Router (`/api/admin`)

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/admin/access` | Admin | — | `AdminAccessResponse` | Used by frontend gate to verify privileges. |
| `GET` | `/api/admin/users` | Admin | Query: optional `search`, `tier`, `status` | `List[UserListItem]` | No pagination yet; consider adding before large data sets (plan §1.6). |
| `GET` | `/api/admin/users/{user_id}` | Admin | — | `UserDetail` | Aggregates asset/destination counts via joins. 404 if user missing. |
| `POST` | `/api/admin/users/{user_id}/suspend` | Admin | `SuspendUserRequest` (`reason`) | `{ "success": true }` | Returns 400 if already suspended. Generates `AdminAction`. |
| `POST` | `/api/admin/users/{user_id}/unsuspend` | Admin | — | `{ "success": true }` | Clears suspension flags. |
| `PATCH` | `/api/admin/users/{user_id}/tier` | Admin | `ChangeTierRequest` (`new_tier`, optional `reason`) | `{ "success": true, "tier": <str> }` | Validates tier enum `free/pro/business/enterprise`. |
| `GET` | `/api/admin/streams/all` | Admin | Optional query `status`, `user_id` | `List[StreamListItem]` | Lists all streams with owner metadata. |
| `POST` | `/api/admin/streams/{stream_id}/stop` | Admin | — | `{ "success": true }` | Forces FFmpeg stop; returns 404 if stream missing. |
| `GET` | `/api/admin/alerts` | Admin | Optional query `resolved`, `severity` | `List[AlertListItem]` | Supports filtering; unresolved first via ordering. |
| `POST` | `/api/admin/alerts/{alert_id}/resolve` | Admin | `ResolveAlertRequest` (`resolution_notes`) | `{ "success": true }` | Marks alert resolved and records resolver. |
| `GET` | `/api/admin/actions` | Admin | Query: optional `limit`, `offset` | `List[AdminActionLog]` | Ordered by newest first. |

## Assets Router (`/api/assets`)

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/assets/` | User | — | `List[AssetResponse]` | Tenant-scoped by `user_id`. |
| `POST` | `/api/assets/` | User | `AssetCreate` | `AssetResponse` (201) | Enforces quotas via `QuotaEnforcer`. |
| `POST` | `/api/assets/upload-complete` | tusd hook | Webhook JSON from tusd | `dict` (`success`, metadata, optional `asset_id`) | Validates uploaded file with ffprobe, ensures path stays inside `uploads/`. |
| `GET` | `/api/assets/{asset_id}` | User | — | `AssetResponse` | 404 if asset missing or belongs to another user. |
| `DELETE` | `/api/assets/{asset_id}` | User | — | `204 No Content` | Deletes DB row and removes file from disk. |

## Playlists Router (`/api/playlists`)

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/playlists/` | User | — | `List[PlaylistResponse]` | Includes eager-loaded `items`. |
| `POST` | `/api/playlists/` | User | `PlaylistCreate` | `PlaylistResponse` (201) | Validates asset ownership for each item. |
| `GET` | `/api/playlists/{playlist_id}` | User | — | `PlaylistResponse` | 404 if missing. |
| `PUT` | `/api/playlists/{playlist_id}` | User | `PlaylistUpdate` | `PlaylistResponse` | Updates metadata; items management handled elsewhere. |
| `DELETE` | `/api/playlists/{playlist_id}` | User | — | `204 No Content` | Cascades delete to `PlaylistItem`. |
| `POST` | `/api/playlists/{playlist_id}/validate` | User | — | `{ "playlist_id": UUID, "compatible": bool, "assets_count": int, "issues": List[ValidationIssue] }` | Returns structured validation issues when assets differ (codec, resolution, pixel format, frame rate, audio). |

## Destinations Router (`/api/destinations`)

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/destinations/` | User | — | `List[dict]` (`id`, `name`, `rtmps_url`, `enabled`, `stream_key_masked`, timestamps) | Keys masked using `mask_stream_key`. |
| `POST` | `/api/destinations/` | User | `DestinationCreate` | `dict` with masked key (201) | Encrypts stream key before storing; enforces quota and domain restrictions. |
| `GET` | `/api/destinations/{destination_id}` | User | — | `dict` with masked key | 404 if not owned by user. |
| `PUT` | `/api/destinations/{destination_id}` | User | `DestinationUpdate` | `dict` with masked key | Allows updating metadata and optionally rotating key. |
| `DELETE` | `/api/destinations/{destination_id}` | User | — | `204 No Content` | Removes destination and decrypted key. |

## Streams Router (`/api/streams`)

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/streams/` | User | — | `List[StreamResponse]` | Lists streams owned by user. |
| `POST` | `/api/streams/` | User | `StreamCreate` | `StreamResponse` (201) | Validates playlist/destination ownership before linking. |
| `POST` | `/api/streams/{stream_id}/start` | User | — | `StreamStatus` | Checks concurrent stream quota, hydrates playlist, and launches FFmpeg via `ffmpeg_manager`. Returns 409 if already running. |
| `POST` | `/api/streams/{stream_id}/stop` | User | — | `StreamStatus` | Gracefully stops FFmpeg; handles already-stopped case. |
| `GET` | `/api/streams/{stream_id}/status` | User | Query optional `refresh` | `StreamStatus` | Reads cached process status; can refresh from manager. |
| `GET` | `/api/streams/{stream_id}/logs` | User | Query `lines` (1–10000) | `StreamLogsResponse` | Streams log tail from disk; 404 if log file missing. |
| `DELETE` | `/api/streams/{stream_id}` | User | — | `204 No Content` | Deletes stream record and associations when stopped. |

## Metrics Router (`/api/metrics`)

| Method | Path | Auth | Request | Response | Notes |
| ------ | ---- | ---- | ------- | -------- | ----- |
| `GET` | `/api/metrics/` | User | — | `dict` with keys `system`, `streams`, `capacity`, etc. | Requires Supabase Bearer token via `get_current_user`. Aggregates psutil CPU/memory/disk stats and active stream counts. |

## Follow-up Items

- Replace `user_id` query parameter in `GET /api/quota` with `require_user` dependency (plan §1.2).
- Add pagination + sorting to `admin` list endpoints before data volume grows.
- Generate machine-readable OpenAPI spec (plan §6) and keep this document in sync via CI check.
