# Глубокий мульти-агентный аудит — 2026-04-25

**Branch:** `codex/project-uix-audit-cleanup`
**Scope:** backend (FastAPI), frontend (Next.js 15), БД/SQLAlchemy + миграции, безопасность, DevOps/инфра.
**Метод:** 5 параллельных специализированных агентов (Backend Architect, Security Engineer, Frontend Developer, Database Optimizer, DevOps Automator), затем сведение и приоритизация.

---

## TL;DR

Проект зрелый: tenant-isolation корректна на уровне FK и сервисного слоя; ffmpeg вызовы используют argv-форму без shell; Fernet+PBKDF2 для stream key корректен; systemd-юниты для production имеют редко встречающийся уровень hardening (полный CapabilityBoundingSet, ProtectSystem=strict, SystemCallFilter, streaming.slice). **Critical уязвимостей не найдено.**

Однако есть **8 High-severity рисков**, без устранения которых выход в production небезопасен:

1. **SSRF + tee meta-character injection** через custom RTMPS destination (нет allowlist/блокировки RFC1918).
2. **Stream key утекает через `ps auxww`** — попадает в argv ffmpeg как plain CLI-аргумент.
3. **Отсутствует ротация ключа шифрования** (Fernet, не MultiFernet) — `ENCRYPTION_KEY` нельзя сменить без потери всех stream key/tokens.
4. **TOCTOU в quota-чеках** для destinations/assets/streams (race window под параллельными запросами).
5. **FFmpeg-потомки наследуют process group** API-родителя — SIGTERM на backend убивает все стримы; в `manager` режиме нет survival.
6. **Backend Dockerfile запускается под root** + entrypoint.sh не подключён в CMD.
7. **Frontend не имеет CSP** — security headers только из FastAPI middleware, который не покрывает Next.js HTML.
8. **i18n-регрессия**: весь dashboard захардкожен на украинском под `eslint-disable`, при этом en/ru bundles уже существуют.

Дополнительно: нет backup/DR для Postgres и `/uploads`, нет CI-сканирования образов (Trivy/Grype), миграции 018 без `CONCURRENTLY` (lock prod-таблиц), отсутствует пагинация на listing-эндпоинтах.

---

## 1. Критические/высокие риски (приоритизированы)

### H1 — SSRF + tee-injection через custom RTMPS
**Файлы:** `backend/app/core/quota.py:377-415`, `backend/app/streaming/command_builder.py:66-90`
**Угроза:** при `custom_rtmps_enabled=True` пользователь вводит произвольный URL: `rtmp://attacker.tld/live/key` или `rtmp://10.0.0.1/internal`. Нет блокировки RFC1918, link-local, `localhost`, `169.254.169.254`, нет hostname allowlist. Tee-таргет конструируется конкатенацией — URL с символами `[`, `]`, `|`, `\` ломает синтаксис tee и инъектит дополнительные outputs/options.
**Fix:** allowlist хостов или blocklist приватных диапазонов; reject URL с `[ ] | \`; повторная DNS-резолюция и проверка на старте стрима.

### H2 — Stream key в argv ffmpeg (читается через `/proc`)
**Файлы:** `backend/app/streaming/ffmpeg_manager.py:337`, `command_builder.py:20-29`
**Угроза:** decrypted RTMP URL+key передаётся как argv → виден через `ps auxww`, `/proc/$pid/cmdline`. Любой co-tenant/sidecar/ops-tooling видит активные ключи.
**Fix:** передавать через файл (`-protocol_whitelist file,…` + auth.config) или через named pipe/stdin; на хосте включить `hidepid=2`.

### H3 — Нет ротации `ENCRYPTION_KEY`
**Файл:** `backend/app/core/security.py:30-38, :96`
**Угроза:** один `Fernet`. Смена `ENCRYPTION_KEY` мгновенно ломает все `stream_key_encrypted` + YouTube `access/refresh_token_encrypted`. Нет runbook для compromise.
**Fix:** `MultiFernet([new, old])`, `ENCRYPTION_KEY_PREVIOUS` в settings, миграционная команда rewrap.

### H4 — TOCTOU в quota-чеках
**Файлы:** `backend/app/core/quota.py:188-216, :339-376`, `services/quota/service.py:118-170`
**Угроза:** SELECT count → INSERT без row-lock. Advisory lock в `services/streams/control.py:269-277` есть **только** для `start_stream` и трункирует UUID до 8 байт (collision risk). Параллельные `POST /api/destinations` могут оба пройти `count < limit`.
**Fix:** `SELECT … FOR UPDATE` на `user_profiles` в той же транзакции, что и quota-mutation, или `pg_advisory_xact_lock` per resource class.

### H5 — FFmpeg children в process group родителя + auto-restart loop
**Файлы:** `backend/app/streaming/ffmpeg_manager.py:341` (`preexec_fn=None`), `:1432-1519` (`_handle_stream_failure`)
**Угроза 1:** SIGTERM/SIGINT на backend → бродкаст в группу → все стримы умирают одновременно.
**Угроза 2:** `restart_attempts` хранится в in-memory `stream_info`; `cleanup_dead_streams` (`:1710-1754`) может прунить запись между failure и restart → счётчик сбрасывается в 0 → бесконечный restart-loop.
**Fix:** `start_new_session=True` (или `preexec_fn=os.setsid`); `restart_attempts` персистить на `Stream` модели; `_monitor_process` сделать единственным источником правды для cleanup.

### H6 — Backend Dockerfile под root + entrypoint не подключён
**Файлы:** `backend/Dockerfile:1-34`, `backend/entrypoint.sh:1-22`
**Угроза:** uvicorn внутри контейнера — UID 0, нивелирует hardening. `entrypoint.sh` (с retry-логикой `apply_migrations.py`) не используется в `CMD`.
**Fix:** добавить non-root `streambot`-пользователя, `chown -R`, `USER streambot`; `ENTRYPOINT ["bash","entrypoint.sh"]`.

### H7 — Нет CSP на frontend
**Файлы:** `backend/app/middleware/security_headers.py:31-45`, отсутствие `headers()` в `frontend/next.config.js`
**Угроза:** FastAPI security-headers middleware не покрывает HTML, отдаваемый Next.js. Реальный user-facing surface без CSP. Backend `connect-src` имеет `wss:` whitelist (любой WebSocket).
**Fix:** `next.config.js`/edge proxy с `Content-Security-Policy`, `X-Frame-Options DENY`, `Referrer-Policy`. Сузить `wss:` до явных хостов.

### H8 — i18n-регрессия в авторизованной зоне
**Файлы:** `frontend/src/app/dashboard/page.tsx:2,121-355`, `dashboard/streaming/page.tsx:2,407-933`, `components/layout/Topbar.tsx:2,54-56,132`, `components/streaming/AddChannelModal.tsx:2`, `library/AssetCard.tsx:2`, `ui/CommandPalette.tsx:2`, `dashboard/{plans,schedule,profile,library}/page.tsx:2`, `Gamification/BroadcasterLevel.tsx:1`
**Угроза:** file-level `eslint-disable i18next/no-literal-string`, весь dashboard на украинском, при том что `messages/en/`, `messages/ru/` уже существуют. Documented audit (`docs/audit/2026-04-25_…md`) этого не отметил.
**Fix:** удалить disables, маршрутизировать через `useTranslations('dashboard'|'streaming.page'|…)`, добавить CI-gate на `eslint-disable i18next/*`.

---

## 2. Backend архитектура (Backend Architect)

**Сильные стороны:**
- Чистый layering routes → services → models. Control plane vs data plane разделены (`StreamService` vs `StreamControlService`).
- Tenant isolation на каждом `select()` через `user_id == self.user_id`.
- PG advisory lock для `start_stream` + `SELECT FOR UPDATE SKIP LOCKED` в scheduler.
- Heartbeat-driven systemd reconciler на boot — антизомби-механика для DB-rows.
- Pydantic settings с validators на default-секреты (rejecting в non-dev).

**Medium issues:**
- `services/streams/control.py` (1047 LOC) и `streaming/ffmpeg_manager.py` (1858 LOC) — god-modules. Делить.
- `core/quota.py` (1174 LOC) смешивает enforcement, guidance tables, validation, alerts.
- Нет API versioning (`/api/v1`).
- `hot_swap.py` `SlotQueue._run` крутит `asyncio.sleep(duration)` decoupled от ffmpeg playhead → glitches при буферизации/FIFO recovery. Нужен `-progress pipe:1`.
- Нет тестов на `core/encryption`, key rotation, destination tenant-swap, hot-swap concurrency.
- Tee `onfail=ignore` молча роняет destination без DB-event — multi-destination users слепы.

---

## 3. Безопасность (Security Engineer)

**Что чисто:**
- Все ffmpeg/ffprobe вызовы — `create_subprocess_exec(*cmd, …)` с list-argv, без shell.
- Path traversal заблокирован `_ensure_within_upload_root` (`upload_service.py:709-721`); финальное имя — tusd UUID, не user-controlled.
- tusd HMAC верифицируется через `hmac.compare_digest`, в prod/staging missing-secret = 503.
- `ENABLE_DEV_AUTH` имеет field_validator, raises вне `ENVIRONMENT=development`.
- Per-tenant authorization на каждом resource service (read/update/delete фильтрует по `user_id`).
- Download/upload tokens HMAC-SHA256 + `compare_digest`, expiry-checked.

**Кроме H1-H7 выше:**

**Medium:**
- `M1` — CSRF middleware fallback на `encryption_key` (`main.py:104`) — key reuse across security domains.
- `M2` — `verify_upload_token(allow_expired=True)` без replay-store; nonce проверяется только структурно. Если `TUSD_HMAC_SECRET` утечёт — replay window unbounded. Fix: nonce в Redis с TTL.
- `M3` — `_user_cache` (`api/deps.py:55-58`) хранит JWT plaintext в памяти. Кэшировать `sha256(token)` с расшифровкой sub/email/exp.
- `M4` — `_get_client_ip` доверяет `X-Forwarded-For` если `client.host` в `trusted_proxy_networks`. Validate `trusted_proxies` is non-empty AND not too broad на boot.
- `M5` — `/api/assets/download/{token}` — нет binding к IP/UA, leaked URL = leaked file. TTL=5m (ок), но добавить UA-bind.

**Rate limiting (H3 в исходных):** `/api/auth/refresh`, `/api/assets/upload-token`, `/api/streams/{id}/logs`, `/api/youtube/oauth/*` наследуют дефолтный 60/min — слишком высокий для token-mint endpoints. Ввести per-user dimension (после auth dependency), снизить до 10-20/min на mint-эндпоинтах.

**Low:**
- `passlib[bcrypt]==1.7.4` (last release 2020) — мёртвый груз, удалить если не используется.
- `.env.example` ships `METRICS_ACCESS_TOKEN=change_this_metrics_token` literally — сменить на `GENERATE_RANDOM_*` placeholder.
- `NEXT_PUBLIC_DEV_BYPASS_AUTH=1` пакуется в bundle — footgun, гейтить server-only env + `NODE_ENV !== production`.
- CORS `allow_methods=["*"], allow_headers=["*"]` — энумерировать.

---

## 4. Frontend / UX (Frontend Developer)

**Сильное:**
- `Modal.tsx` — настоящий focus trap + restore previous focus + Escape handling.
- Streaming page разложена на хуки (`useStreamingPageData`, `useStreamMutations`, `useLiveEditor`, `useQualityGate`).
- React Query с optimistic running/stopping sets — нет хаоса fetch-in-useEffect.
- Sidebar полностью локализован, `aria-current="page"`.

**High (помимо H8):**
- **Нет App-Router boundaries.** `find src/app -name 'loading.tsx' -o 'error.tsx' -o 'not-found.tsx'` → 0. Все падения попадают в class-boundary в `dashboard/layout.tsx:124`. Добавить per-segment `loading.tsx`/`error.tsx`/`not-found.tsx`.
- **Server/client boundary неверная на лендинге.** `src/app/page.tsx` сразу рендерит `HomePageClient` (608 LOC, framer-motion + 12 lucide-icons + `ImmersiveBackground` 270 LOC). `FeaturesGrid`, `BenefitsSection`, `PricingCards`, `CTASection`, `Footer`, `HowItWorks` — pure, могут быть RSC. Конвертация ~ половинит landing JS.
- **Нет lazy для модалов.** `streaming/page.tsx:23-30` eager-import `StreamBuilderModal`, `LiveEditorModal`, `QualityGateModal`, `AddChannelModal` — все за boolean-gate. `next/dynamic({ ssr: false })`.
- **`useState<any>`** для auth user в `dashboard/layout.tsx:36` и `dashboard-context.tsx:8` — тип `User` от `@supabase/supabase-js` уже импортирован.
- **`<img>` вместо `next/image`** в `library/AssetCard.tsx:180,257` (самая частая карточка). CLS, нет AVIF/WebP, file-level `eslint-disable`.

**Medium:**
- E2E coverage обманчиво. `e2e/dashboard-flows.spec.ts` — 74 строки, 2 теста, оба про TUS path shape. Streaming start/stop, upload, library CRUD, profile YouTube OAuth callback, admin — нулевое E2E покрытие.
- `as any` для translation keys (12 occurrences в `admin/*`, `library/page.tsx:374`).
- DarkModeToggle FOUC: `useState(mounted)` рендерит пустой placeholder. Использовать `useSyncExternalStore` с SSR snapshot.
- Stream-list polling всегда-on: `dashboard/page.tsx:34` — `refetchInterval` вычисляется один раз на mount.
- Mobile <768px: raw inline styles (`fontSize:24/20/13` px), bypass design tokens.

**Quick wins (≤30 min):**
- Тип auth user → `User | null` (2 места).
- `next/dynamic` 4 модала на streaming page.
- `LANGUAGE_OPTIONS`/`TIMEZONE_OPTIONS` из `profile/page.tsx:24-25` → `messages/*/profile.json`.
- `app/dashboard/loading.tsx` skeleton.
- `refetchInterval` как функция.
- `<img>` → `next/image unoptimized` в `AssetCard.tsx`.

---

## 5. БД и data layer (Database Optimizer)

**Сильное:**
- Tenant `user_id` индексирован везде, FK `ON DELETE CASCADE`.
- Pool config sound (`db_pool_size=10`, `pool_pre_ping`, `pool_recycle=1800s`).
- `_managed_session` корректный rollback-on-exception + close.
- UTC discipline на timestamps; `created_at`/`updated_at` триггеры.

**High:**
- **Migration 018** (`migrations/018_performance_indexes.sql:6-65`) — каждый `CREATE INDEX` без `CONCURRENTLY` → `ACCESS EXCLUSIVE` lock на `streams`/`assets`. Конвертировать в `CONCURRENTLY` (помнить: нельзя в транзакции).
- **Migration drift.** `core/database.py:168-171` дропает trigger `trigger_update_user_storage` + `update_user_storage_usage()` на каждом `init_db()`. Trigger создан `migrations/004:38-68`. Runtime negates миграцию, но в `migrations/` нет соответствующего drop. Добавить `0XX_drop_storage_trigger.sql`.
- **Нет `down`/rollback.** Combined с runtime-DDL в `init_db` → невозможно воспроизвести clean migration history.
- **Нет пагинации** на `list_assets`/`list_streams`/`list_playlists`/`list_destinations`. User с 10k assets получает full table back + per-asset usage join.

**Medium:**
- N+1 в `services/playlists/service.py:182-196` (`_get_asset` per item). Заменить на `select(...).where(Asset.id.in_(asset_ids))`.
- Recursive ancestor walk в `services/media_folders/service.py:300-313` (`_ensure_not_descendant`) — N round-trips. Recursive CTE.
- `serialize_assets` (`services/assets/serializers.py:266-292`) — 4 query per page (folders, playlist usage, collection usage, stream usage).
- Daily streaming hours считается в Python (`core/quota.py:296-329`) — single SQL `SUM(EXTRACT(EPOCH FROM …))` достаточно.
- `_calculate_recent_stream_hours` использует `select(Stream)` — нужны только `started_at, stopped_at`.
- `streams.playlist_id` ON DELETE RESTRICT → `IntegrityError` 500 вместо 409 при race. Catch в `delete_playlist`.

**JSONB:** `assets.meta`, `assets.codec_info`, `streams.settings_json`, `system_alerts.details`, `admin_actions.details`, `user_activity_log.details`, `youtube_connections.scopes_json` — без GIN. Если объёмы вырастут — `CREATE INDEX … USING gin (… jsonb_path_ops)`.

**Рекомендуемые индексы (concrete):**

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stream_destinations_stream_dest
  ON stream_destinations(stream_id, destination_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_user_type_created
  ON assets(user_id, asset_type, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streams_playlist_id
  ON streams(playlist_id) WHERE playlist_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streams_video_collection
  ON streams(video_collection_id) WHERE video_collection_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streams_audio_collection
  ON streams(audio_collection_id) WHERE audio_collection_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_system_alerts_stream_unresolved
  ON system_alerts(stream_id, created_at DESC)
  WHERE resolved = false AND alert_type = 'ffmpeg_error';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stream_events_stream_level_time
  ON stream_events(stream_id, level, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_upload_ingests_user_status_received
  ON upload_ingests(user_id, status, received_at DESC);
```

---

## 6. DevOps / инфра (DevOps Automator)

**Сильное (редко встречающаяся зрелость):**
- Hardened systemd templates (`docs/systemd/ffmpeg@.service.example`, `youtube-backend.service.example`) с полным `NoNewPrivileges`, empty `CapabilityBoundingSet`/`AmbientCapabilities`, `ProtectSystem=strict`, `ProtectKernelTunables/Modules/Logs/ControlGroups`, `ProtectProc=invisible`, `MemoryDenyWriteExecute`, `SystemCallFilter=@system-service` minus opasные группы. `streaming.slice` aggregating CPUQuota=300% MemoryMax=5G TasksMax=512.
- **Live-stream-aware deploy guard.** `deploy_vps.sh::guard_stream_runtime` запрашивает Postgres на active streams и блокирует non-frontend deploys. `ALLOW_LIVE_STREAM_RESTARTS=1` — escape hatch.
- Selective per-service deploys с cache scopes (`backend|tusd|frontend`), `compute_deploy_impact` → `frontend_only_deploy`, `host_runtime_only_refresh`.
- Structured JSON logs с PII-маскингом (`api_key/secret/password/token/bearer/email`) + correlation_id/request_id/user_id contextvars.
- Reproducible Caddy config: рендер из template + diff-проверка в CI.

**High (помимо H6):**
- **Нет /readyz vs /healthz.** `main.py:265` — unconditional `{"status":"healthy"}`. Caddy/healthcheck помечает backend ready пока Postgres warming. Split на `/livez` (process up) и `/readyz` (DB pool, Redis, upload-dir writable, MediaMTX reachable).
- **Нет log rotation, нет Prometheus scraper, нет alert rules.** `/api/metrics/prometheus` существует, но никем не скрейпится; нет prometheus.yml/alertmanager.yml. Endpoint vestigial.
- **Нет backup/DR.** Zero ссылок на `pg_dump`, `wal-g`, `restic`, `borg`. `postgres` Compose с named volume + `restart: unless-stopped` → диск VPS = total data loss.
- **Нет image vulnerability scan в CI.** `make security-audit` (pip-audit, npm audit) только локально. Никакой Trivy/Grype/CodeQL перед `docker/build-push-action`. Добавить Trivy `--severity HIGH,CRITICAL` гейт.
- **Нет tracing.** Никаких `opentelemetry-*` пакетов; correlation_id уже плумится — minimal OTEL FastAPI + OTLP к Tempo/Jaeger даст cross-service correlation.
- **Caddy без `request_body { max_size }` override.** Tusd сконфижен на 10 GiB, но Caddy дефолт оставлен. Misconfig elsewhere не failed-fast. Также нет rate_limit плагина.
- **Secrets handling: prod `.env` plaintext on disk.** Нет sops/age/Vault. CI инжектит через GitHub Secrets правильно, но `ssh-keyscan -H` не пиннит fingerprint.

**Medium:**
- `backend/Dockerfile` single-stage — multi-stage даст ~150 MB меньше.
- Pin base images by digest (`python:3.11-slim@sha256:…`).
- mypy не gate в CI (`backend-quality.yml`); локально gated за `RUN_MYPY=1`.
- Нет Playwright e2e в CI (только Jest).
- `deploy_vps.sh:281` `git reset --hard origin/main` — destructive, добавить audit step.
- Migrations runs **after** backend container is up — инвертировать, миграции до cutover.
- Compose `caddy` сервис не используется в prod (host-native), но без `profiles: [legacy]` → port conflict-risk.
- `streaming.slice` MemoryMax=5G TasksMax=512 — задокументировать max concurrency.
- `backend/.env.bak-*` в working tree — verify .gitignore.

---

## 7. Сводная таблица приоритетов (single pane)

| ID | Severity | Area | Файл | Оценка усилий |
|---|---|---|---|---|
| H1 | High | Security/Backend | `core/quota.py:377-415`, `streaming/command_builder.py:66-90` | M (2-4ч) |
| H2 | High | Security | `streaming/ffmpeg_manager.py:337` | M (4-8ч) |
| H3 | High | Security | `core/security.py:30-38` | S (2-3ч) |
| H4 | High | Backend/DB | `core/quota.py:188-216, :339-376` | M (3-5ч) |
| H5 | High | Backend | `streaming/ffmpeg_manager.py:341, :1432-1519` | M (3-5ч) |
| H6 | High | DevOps | `backend/Dockerfile`, `entrypoint.sh` | XS (30 мин) |
| H7 | High | Frontend/Sec | `frontend/next.config.js` | S (1-2ч) |
| H8 | High | Frontend | dashboard/* (множественно) | L (1-2 дня) |
| — | High | DB | `migrations/018` (без CONCURRENTLY) | S (1ч) |
| — | High | DB | Pagination missing на listing API | M (2-4ч) |
| — | High | DevOps | Postgres backup + `/uploads` rsync | M (4ч) |
| — | High | DevOps | Trivy в CI | XS (1ч) |
| — | High | DevOps | `/readyz` vs `/healthz` split | S (1-2ч) |
| — | Medium | Backend | god-modules `control.py`, `ffmpeg_manager.py`, `quota.py` | L (2-3 дня) |
| — | Medium | DB | N+1 в playlists/folders, `serialize_assets` 4-query | M (4ч) |
| — | Medium | DevOps | Prometheus scraper + alert rules | M (1 день) |
| — | Medium | Frontend | App Router boundaries (loading/error) | S (2ч) |
| — | Medium | Frontend | E2E coverage пустой за пределами TUS | L (2-3 дня) |
| — | Medium | Frontend | RSC-конвертация лендинга | M (4ч) |

---

## 8. Что было ОК (фиксируем не разрушать)

- ffmpeg/ffprobe — argv-форма везде. Не регрессировать в shell-interpolation.
- tusd HMAC + `compare_digest` — корректная валидация.
- Tenant isolation на сервисах — каждый read/write фильтруется по `user_id`.
- `enable_dev_auth` field_validator — production guard работает.
- Path traversal — `_ensure_within_upload_root` resolve-then-ancestor pattern.
- Systemd hardening — лучший в категории, эталон для других сервисов.
- Live-stream-aware deploy guard — редкая операционная зрелость.
- Encryption: Fernet+PBKDF2 100k iters + env-derived salt + non-default validator.

---

## 9. Рекомендованный порядок ремонтов (sprint plan)

**Спринт 1 (security + production-blocker):** H6, H7, H3, миграция 018 → CONCURRENTLY, Trivy в CI, `/readyz`.

**Спринт 2 (стримы):** H2, H5, H1, H4. После этих фиксов production-launch становится безопасным.

**Спринт 3 (UX/i18n):** H8 (раскат i18n по dashboard), App Router boundaries, RSC-конвертация лендинга, lazy-модалы.

**Спринт 4 (operational maturity):** Postgres backup + DR, Prometheus scrape + Alertmanager, OTEL tracing, mypy/e2e в CI, log rotation, rate-limit per-user dimension.

**Спринт 5 (tech debt):** разбиение god-modules, добавление пагинации, GIN-индексы по объёмам, тесты на encryption rotation/hot-swap concurrency/destination tenant-swap.

---

**Авторы аудита:** Backend Architect, Security Engineer, Frontend Developer, Database Optimizer, DevOps Automator (parallel).
**Длительность:** ~3.5 минуты wall-clock (5 агентов параллельно).
