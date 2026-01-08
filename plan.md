# Plan — youtube_translation (виконуваний, поетапний)

Цей план зібраний з `requirements.md`, `requirements (1).md` (обидва від **2026‑01‑08**) та аудиту репозиторію. Мета — **зафіксувати “що робимо далі” з правильними пріоритетами**, враховуючи що базове ядро вже реалізоване.

## Узгоджені рішення (станом на 2026‑01‑08)
- **Primary deployment (для дешевого VPS/self‑host):** `docker compose` (однією командою піднімаємо весь стек).
- **Runner у Docker:** окремий сервіс `runner/supervisord` у `docker/docker-compose.yml` (щоб рестарт API не зупиняв FFmpeg).
- **Assets deletion (MVP):** “safe delete” як default (блокуємо видалення, якщо asset використовується; `force` не показуємо звичайним юзерам / лишаємо адмінам).
- **Optimize pipeline:** hybrid — auto‑optimize тільки для дозволених tier/умов; для решти manual “Optimize”.
- **Auto‑optimize поріг:** `max_size=2GB`, `max_duration=60min` (для tier з `automation_enabled=true`).
- **Timezone:** зберігаємо `timezone` у `user_profiles`, часи в БД зберігаємо в UTC, UI показує в таймзоні юзера.

## Як читати план
- **P0** — блокує надійність/реліз (робимо першим).
- **P1** — сильно підсилює MVP/UX (робимо після P0).
- **P2** — корисно, але можна відкласти.
- Для кожного етапу є **DoD** (Definition of Done) і короткі **AC** (acceptance criteria).

## Scope
- **In (найближчі етапи):** scheduler stop/repeat, production runner (supervisor/systemd), optimize pipeline, YouTube OAuth/API, VOD segmentation, live controls, документація/UX, регресійні тести.
- **Out (поки що):** повноцінний overlay designer, billing/self‑serve, Kubernetes/мікросервіси без потреби, enterprise teams/RBAC (як окремий великий блок).

## Поточний стан (вже зроблено)
✅ Auth (Supabase JWT), multi‑tenant по `user_id`  
✅ Library: tusd resumable uploads + hooks, ffprobe validation, папки/колекції/плейлисти  
✅ Streams: start/stop/status/logs, multi‑destination через `tee`, auto‑restart/backoff, live edit/hot‑swap/queue  
✅ Observability: метрики + структуровані логи + базовий UI  
✅ Runtime режими: `manager` / `supervisor` / `systemd`, CLI runner + reconciler  

---

# Phase 0 — Узгодження “production default” і baseline (P0)

**Ціль:** прибрати невизначеність “як деплоїмо” + отримати стабільний baseline для швидких змін.

## 0.1. Зафіксувати deployment‑профіль (P0)
- Зафіксувати “production default” як **Docker Compose** (для VPS/self‑host).
- Зафіксувати в README/доках:
  - який `STREAM_RUNTIME_MODE` є default,
  - як керувати стрімами (через API + supervisor),
  - як переживається рестарт API.
- Залишити окрему секцію “Alternative: systemd” для Linux‑деплою без Docker (бо код це підтримує).

**DoD**
- Є 1 сторінка “Production deployment” (мінімум), без суперечностей з фактичними файлами (`docs/systemd/*`, `backend/supervisord.conf`, `docker/docker-compose.yml`).

## 0.2. Baseline tests + smoke (P0)
- Прогнати і зафіксувати команди (див. `docs/TESTING.md`):
  - backend pytest
  - frontend unit
  - e2e playwright
- Додати короткий “smoke сценарій”:
  - upload → create destination → create stream → start → stop → logs.

**DoD**
- У плані релізу є “обов’язковий набор команд”, які мають проходити перед merge/release.

## 0.3. Dependency refresh (мінімальний) + smoke (P2)
> Рекомендація з `requirements (1).md`: оновлювати мінімально, по одному пакету, щоразу проганяючи smoke tests.

**Задачі**
- Backend: перевірити апдейти FastAPI/Pydantic/SQLAlchemy та сумісність (pinning).
- Frontend: перевірити узгодженість Next.js/React/типів.
- Після кожного апдейту: прогнати baseline tests (0.2).

**AC**
- Жодних “масових апдейтів” без потреби; зміни маленькими кроками.

---

# Phase A — Стабілізація MVP (Ship‑ready) (P0 → P1)

**Ціль:** сервіс надійно стартує/стопає стріми по таймеру і **не втрачає ефір** при рестартах API.

## A1. Scheduler: `stop_at` (one‑shot) + stop job (P0)
**Що є:** `scheduled_start_time` + launcher (`backend/app/services/streams/scheduler.py`).  
**Що треба:** stop‑частина + чіткий state machine.

**Задачі**
1) **DB/model**
   - Додати поля в streams:
     - `scheduled_stop_time` (TIMESTAMPTZ, nullable)
     - (опц.) `scheduled_stop_enabled` / `scheduled_stop_attempted_at` (для retry)
   - Міграція + оновлення `backend/app/models/database.py`.
2) **Backend scheduler**
   - Додати `stop_due_streams()` і викликати в циклі поруч зі `launch_due_streams()`.
   - Idempotency:
     - lock через `SELECT … FOR UPDATE SKIP LOCKED`,
     - перевірка статусу (stop лише якщо stream “running/starting”).
   - Поведінка при помилках: retry interval, логування, не блокувати інші стріми.
3) **API + schemas**
   - Розширити Stream create/update schema (де зараз `scheduled_start_*`) на stop поля.
4) **Frontend**
   - Додати в Stream builder/редактор:
     - `start_at` і `stop_at`,
     - зрозуміле відображення timezone (див. A2).
5) **Тести**
   - Backend: unit/integration для stop job (мок часу або “due” записи).
   - E2E: сценарій “schedule start через 1 хв, stop через 2 хв” (з прискоренням через mock часу або прямим встановленням `scheduled_*_time` у минуле).

**AC**
- Якщо `stop_at` в минулому і стрім running → зупиняється.
- Scheduler не робить подвійний stop і не створює race conditions.

## A2. Timezone (на рівні UI/даних) (P0)
**Мінімально:** зберігаємо часи в UTC, у UI показуємо локально.  
**Опційно:** timezone per stream (потрібно для repeats у v1).

**Задачі**
- Додати `user_profiles.timezone` (наприклад `Europe/Kyiv`) і використовувати його як default для UI.
- Frontend:
  - детерміновано показувати “Local time (Europe/Kyiv)” і “UTC”.
  - валідатор: `stop_at > start_at`.
- Backend:
  - валідація payload (tz‑aware datetime).

**AC**
- Один і той самий стрім має однаковий час у різних браузерах (через збережений timezone або явний UTC‑показ).

## A3. Production runner для Docker/self‑host (P0)
**Ціль:** при рестарті FastAPI стріми не падають (у production‑режимі).

**Задачі**
- Додати в `docker/docker-compose.yml` окремий сервіс `runner/supervisord`, який:
  - монтує `../backend/supervisord` (programs + logs) спільно з `backend`,
  - має доступ до `../backend/uploads`, `../backend/streams`, `../backend/logs`,
  - запускає `supervisord` з `backend/supervisord.conf`.
- Забезпечити доступ `backend` до supervisor control:
  - або через **shared unix socket volume** (безпечніше, без відкриття TCP),
  - або через внутрішній TCP (лише в docker network + auth).
- Перевірити end‑to‑end:
  - start stream → рестарт backend → stream продовжує йти → UI синхронізується (reconciler).

**AC**
- Рестарт API не зупиняє стрім (в обраному production‑mode).

## A4. Політика видалення assets (P1)
**Що є:** delete блокується якщо asset використовується (409), `force=true` дозволяє “знести”.  
**Рішення для MVP:** safe delete як default (без soft delete), щоб не видаляти файли, які FFmpeg може ще відтворити.

**Задачі**
- Прибрати `force` з UI для звичайних користувачів (або показувати тільки адмінам).
- Залишити safe delete (409 + usage details) як основний сценарій.
- UI:
  - показувати “Asset in use” з переліком залежностей (вже повертається в 409).

**AC**
- Неможливо випадково зламати активний стрім через видалення файлу.

## A5. Документація в продукті: “first stream” + YouTube ingest (P1)
**Задачі**
- UI (Destinations):
  - help‑секція: де взяти RTMPS URL і stream key,
  - попередження про VOD <12h (архівування),
  - “recommended encoder settings” (GOP 2s, H.264/AAC).
- Repo docs:
  - короткий “First Stream Checklist” для self‑host (env vars, ffmpeg path, storage, quotas).

**AC**
- Користувач може налаштувати destination без пошуку по документації.

---

# Phase B — Cost‑aware: Optimize pipeline (P0 → P1)

**Ціль:** зменшити CPU і підвищити стабільність стрімів: “optimize once → stream copy‑mode”.

## B1. Дизайн “Optimize once” (P0)
**Задачі**
- Узгодити підхід:
  - queue на Redis (вже є dependency) + worker процес,
  - або простий background worker (але тоді restart‑стійкість гірша).
- Додати мінімальні сутності:
  - `asset_derivatives` (або поля в assets) з:
    - `variant` (youtube_720p / youtube_1080p / audio_only),
    - `path`, `codec_profile`, `ready`, `error`, `updated_at`.
- Визначити “stream‑ready профіль” (H.264/AAC, yuv420p, keyframe 2s, CBR/мікс).

**DoD**
- Є описаний pipeline + структура даних (в цьому репо), щоб реалізація була прямолінійною.

## B2. Реалізація worker + API (P0)
**Задачі**
- Backend:
  - endpoint “optimize asset” (manual),
  - auto‑enqueue після upload для “allowed tiers” (hybrid), наприклад:
    - тільки якщо `compatible_for_copy=false`,
    - тільки якщо tier має `automation_enabled=true` (зараз це фігурує у тарифах на кшталт `fhd_boost`, `uhd_flow`, `uhd_boost`),
    - і тільки якщо файл/тривалість в межах CPU‑бюджету (`max_size=2GB`, `max_duration=60min`).
  - worker виконує ffmpeg transcode, пише derivative, оновлює БД.
- Streaming:
  - PlaylistBuilder/Stream runner підбирає derivative (якщо ready), інакше original.
- Rate limits/quotas:
  - ліміт concurrent оптимізацій по плану (щоб не “вбити” сервер).

**AC**
- Після optimize стрім з derivative стабільно йде в `-c copy` (де можливо).

## B3. UI для optimize (P1)
**Задачі**
- В Library:
  - badge “Not stream‑ready / Optimizing / Ready / Error”,
  - кнопка Optimize (якщо дозволено планом).
- В streaming builder:
  - попередження, якщо в плейлисті є “not stream‑ready” і це змусить re‑encode.

## B4. “Test destination” (RTMP/RTMPS connectivity check) (P2)
**Задачі**
- Backend:
  - додати endpoint типу `POST /api/destinations/{id}/test`,
  - валідація URL + (опц.) TCP connect до ingest host:port без старту FFmpeg,
  - SSRF‑захист: дозволені схеми, блок внутрішніх IP/localhost (мінімум — denylist).
- Frontend:
  - кнопка “Test connection”, показ результату/помилки.

**AC**
- Перевірка не розкриває stream key і не стартує стрім.

## B5. Alerts/notifications “stream down” (P2)
**Задачі**
- Backend:
  - детектор: “stream у статусі running, але процес не живий/нема прогресу N хв”,
  - канали: webhook (мінімум) + (опц.) email/telegram,
  - налаштування на рівні user/stream.
- UI:
  - просте налаштування webhook URL + toggle.

**AC**
- Сповіщення приходить ≤60 сек після падіння (ціль з requirements).

---

# Phase C — v1 конкурентність (scheduler repeats + VOD + YouTube OAuth/API + live controls) (P1 → P2)

## C1. Repeating schedule (daily/weekly) + windows + timezone per stream (P1)
**Задачі**
- Додати поля:
  - `recurrence_rule` (RRULE або JSON),
  - `timezone` (якщо не зробили в A2),
  - `scheduled_end_time`/`stop_after_duration`.
- Scheduler:
  - обчислення next occurrences,
  - гарантії idempotency,
  - UX для “вікна” (08:00–23:00) і weekly pattern.
- Тести: обов’язково з mock часу.

**AC**
- Повторювані старти/стопи працюють незалежно від DST.

## C2. VOD segmentation (auto‑restart під <12h) (P1)
**Задачі**
- Додати stream setting:
  - `vod_segment_minutes` (напр. 710),
  - `auto_restart_enabled`.
- Реалізувати “graceful restart”:
  - планувальник/watchdog ставить restart до дедлайну,
  - мінімізувати downtime (ціль 1–5 сек).

**AC**
- При увімкненій опції стрім перезапускається до 12h і продовжує відтворення.

## C3. YouTube OAuth + Live Streaming API (P2)
**Задачі**
- Destinations:
  - `platform=youtube`, `oauth_provider=google`,
  - `oauth_refresh_token_encrypted`, `youtube_channel_id`, default broadcast settings.
- OAuth flow:
  - frontend “Connect YouTube” → backend callback → encrypted storage.
- API інтеграція:
  - create liveStream + liveBroadcast,
  - bind, transition (ready → testing → live),
  - синхронізація title/description (мінімум).
- Безпека:
  - rotation/refresh token, мінімальні scopes.
- Тести:
  - інтеграційні тести через mock httpx.

**AC**
- Можна створити/запустити трансляцію без ручного stream key (опційно поряд з RTMP‑режимом).

## C4. Live playback controls (skip/jump/emergency) (P2)
**Поточний фундамент:** є hot‑swap/live edit + `POST /api/streams/{id}/queue` (enqueue).  
**Що треба:** явні контрол‑ендпоінти + UX + пріоритети.

**Задачі**
- Backend:
  - `POST /streams/{id}/controls/skip`
  - `POST /streams/{id}/controls/jump` (to asset_id)
  - `POST /streams/{id}/controls/emergency` (clip, priority)
  - реалізація через:
    - пріоритетну runtime‑чергу, або
    - restart + hot‑swap (простий MVP для skip/jump).
- Frontend:
  - кнопки в stream monitor, модал вибору item.
- AC/UX:
  - emergency clip має пріоритет над іншими змінами.

---

# Загальний DoD (для кожної задачі)
- Код + міграції (де потрібно) + оновлені схеми/API.
- Оновлена документація (мінімум: README/доки + короткий changelog в PR описі).
- Тести проходять: backend pytest, frontend unit, e2e (де релевантно).
- Ручна перевірка критичних flows: upload → stream → start/stop/schedule → logs.

# Open questions (для Phase B/C, не блокують Phase A)
1) Який поріг для auto‑optimize (напр. `max_size_gb`, `max_duration_min`, allowed codecs)?
