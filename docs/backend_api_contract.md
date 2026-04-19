# Backend API Contract

## Final MVP API Surface

This document is the narrow product contract for the backend in the final MVP. It is intentionally shorter than `docs/backend_api_map.md`, which remains the broader routing inventory.

The final MVP depends on these backend responsibilities:

- authentication and current-user resolution
- quota-aware uploads and asset finalization
- playlist CRUD for compatible assets
- destination CRUD for one enabled YouTube RTMPS target
- stream CRUD plus start, stop, status, and logs
- admin access checks and basic operator visibility
- health and metrics endpoints for local validation

## Required Route Groups

### Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

The product path requires one real auth sanity check without DEV bypass before launch.

### Assets

- asset list/create/delete
- upload completion and validation
- authenticated ownership checks

### Playlists

- playlist create/read/update/delete
- compatibility validation

### Destinations

- destination create/read/update/delete
- encrypted stream key storage

The MVP path assumes one enabled destination at launch time.

### Streams

- stream create/read/delete
- stream start
- stream stop
- stream status
- stream logs

This is the center of the MVP launch path.

### Admin and Health

- `GET /api/admin/access`
- `GET /health`
- `GET /api/metrics/`

These routes support operator sanity checks and troubleshooting during rehearsal.

## Outside Final MVP

These are valid future lanes, but they are not required by the final MVP contract:

- public multi-destination support as a promised launch feature
- host-native `systemd` hardening as the mandatory runtime path
- provider expansion beyond YouTube

Use `docs/backend_api_map.md` for the broader inventory and `docs/MVP_COMPLETE.md` for the final product boundary.
