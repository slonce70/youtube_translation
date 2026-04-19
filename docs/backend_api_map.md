# Backend API Map (FastAPI)

_Updated: April 19, 2026_

This document summarizes the current FastAPI routing surface for the YouTube Multi-Channel Streaming Platform. It focuses on the publicly exposed `/api` namespace and the admin surface, highlighting key dependencies, important behaviors, and broader follow-up lanes outside the narrow final MVP contract.

## Overview

- Application entry point: `backend/app/main.py`
- Shared dependencies: `backend/app/api/deps.py`
- Response models: `backend/app/schemas/api.py` and inline Pydantic models per router
- Security primitives: Supabase JWT (`require_user`), HMAC-signed tusd hooks, encrypted stream keys

## Route Matrix

| Router | Prefix | Service Layer | Core Responsibilities | Notable Observations |
| ------ | ------ | ------------- | --------------------- | -------------------- |
| `auth` | `/api/auth` | Supabase client helpers | Email/password login, logout, `me` endpoint | Env vars `SUPABASE_URL/KEY` must exist; router already production-ready. |
| `quota` | `/api` | `QuotaService` | tusd quota hook + authenticated usage snapshot | `POST /api/internal/check-quota` вимагає `X-Tusd-Signature`; проксі повинен обмежувати доступ до localhost. |
| `admin` | `/api/admin` | `AdminService` + `schemas/admin.py` | User/stream/audit tooling, alerts, suspensions | Потрібна пагінація та rate-limit; сервіс логує всі дії. |
| `assets` | `/api/assets` | `AssetService`, `AssetUploadService`, download helpers | CRUD, валідація аплоадів, токени завантаження | Вся quota/stream-summary логіка тепер у сервісі; роутер тонкий. |
| `playlists` | `/api/playlists` | `PlaylistService` | Playlist CRUD, asset validation, builder інтеграція | Сервіс перевіряє квоти й сумісність активів перед створенням або оновленням. |
| `media_folders` | `/api/media/folders` | `MediaFolderService` | Папки та bulk-привʼязки активів | Exclusive bulk-режим спершу очищує всі попередні привʼязки. |
| `media_collections` | `/api/media/collections` | `MediaCollectionService` | Відео/аудіо колекції, синхронізація з плейлистами | `origin_playlist_id` відстежує походження; router повертає Pydantic response. |
| `destinations` | `/api/destinations` | `DestinationService` | RTMPS-канали з шифруванням ключів | Маскування ключів і quota-чек централізовані; router залишено dict-сумісним для існуючих тестів. |
| `streams` | `/api/streams` | `StreamService` + `StreamControlService` | Конфіг стрімів, старт/стоп FFmpeg, логи | Control-сервіс працює з `ffmpeg_manager`; Service перевіряє джерела/квоти. |
| `metrics` | `/api/metrics` | psutil helpers + middleware | System/stream метрики, Prometheus export | `GET /api/metrics/` потребує admin auth; `capacity` є евристичним, а не authoritative production limit; `/api/metrics/prometheus` захищений окремим shared token. |

## Endpoint Details

### Public API (`/api`)

- `GET /` → service heartbeat (anonymous)
- `GET /health` → liveness check (anonymous)
- `GET /api/metrics/` → system + stream metrics (requires admin auth; capacity block is heuristic)
- `POST /api/internal/check-quota` → tusd pre-create hook, HMAC optional
- `GET /api/quota/usage` *(in `quota.py`)* → returns tier usage snapshot for authenticated user

### Assets (`/api/assets`)

- `GET /` → list assets scoped by `user_id`
- `POST /` → create asset (quota enforced)
- `POST /upload-complete` → tusd webhook to finalize asset + validation
- `GET /{asset_id}` / `DELETE /{asset_id}` → inspect/delete assets (ensures ownership)

### Playlists (`/api/playlists`)

- `GET /` → list playlists with items (`PlaylistService.list_playlists`)
- `POST /` → create playlist; перевіряє квоти та власність активів
- `GET /{playlist_id}` → fetch playlist з items
- `PUT /{playlist_id}` → оновити метадані/loop
- `DELETE /{playlist_id}` → видалити плейлист (заборонено, якщо асоційовані стріми)
- `POST /{playlist_id}/validate` → перевірити сумісність активів

### Destinations (`/api/destinations`)

- `GET /` → list destinations, returns masked stream keys
- `POST /` → create destination with encrypted key + quota checks
- `GET /{destination_id}` → fetch single destination (masked key)
- `PUT /{destination_id}` → update destination metadata/key
- `DELETE /{destination_id}` → remove destination
- `POST /{destination_id}/test` *(if implemented later)* → **Not present** – plan callout if needed for health checks

- `GET /` → list streams (BД + повʼязані ресурси)
- `POST /` → create stream config (перевіряє playlist/collections/destinations)
- `POST /{stream_id}/start` → quota + старт FFmpeg через `StreamControlService`
- `POST /{stream_id}/stop` → stop FFmpeg, оновити статус
- `GET /{stream_id}` → fetch stream details
- `DELETE /{stream_id}` → delete stream + links
- `GET /{stream_id}/status` → статус
- `GET /{stream_id}/logs` → tail з файлової системи (`lines=...`, `mode=important|raw`)

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

## Post-MVP Follow-Up

1. Pagination для `/api/admin/users|streams|alerts` досі відсутня.
2. Storage quota майже повністю покладається на фон оновлень; переконайтеся, що CRON/validators регулярно оновлюють `current_storage_bytes`.
3. `metrics` залежить від psutil; додавайте його у prod image.
4. Варто формально опублікувати OpenAPI (`/docs`) у README/ops-нотатках для партнерів.

This mapping satisfies the API routing audit baseline. Update this document directly when subsequent verification steps complete.
