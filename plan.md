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

## Оновлення станом на 2026-01-09 (що виправлено/додано)
✅ Виправлено падіння `GET /api/streams/` (eager-load `stream_destinations → destination`), через що список трансляцій стабільно відображається без “рефреш-лупа”.  
✅ Додано міграцію `026_collection_items_updated_at.sql` (локальна БД сумісність: `collection_items.updated_at` + trigger).  
✅ Streaming UI: останній крок створення трансляції в модалці більше не “ховає” кнопку (правильний scroll).  
✅ Library UI: після upload файли з’являються без ручного refresh (довший refetch/backoff).  
✅ Streaming: статус “Зупиняється” більше не зависає — reconciler тепер синхронізує `stopping`, а supervisor parse коректно розпізнає “процесу не існує” як `NOT_FOUND`.  
✅ Логи стрімів: “важливе” за замовчуванням + перемикач “показати всі”, лише `error` підсвічується червоним (решта — сірим).  
✅ FFmpeg: зменшено spam “frame=…” (`-hide_banner -nostats`) + фільтрація progress‑рядків у “important” режимі.  
✅ Library: відео прев’ю більше не порожнє — `thumbnail_url` стабільно зберігається в `assets.meta` + fallback `/thumbnails/{asset_id}.jpg`.  
✅ Рекомендації якості: оновлено рекомендовані bitrate (включно з 720p і підтримкою дробних значень на кшталт `4.5 Mbps`).  
✅ DB: автопатч для старих локальних БД (створює `collection_items.updated_at` + trigger), щоб не ловити 500 на колекціях.

## Польові спостереження з тестування (записуємо окремо)
> Цей блок — “журнал проблем”, які помічаємо під час ручного тесту, щоб не загубити. Кожен пункт має короткий статус.

- [x] Library: після завантаження файл не видно до ручного refresh сторінки (виправлено довшим refetch/backoff).
- [x] Streaming: після створення трансляції показує “створено”, але в списку не з’являється / сторінка перезавантажується (виправлено падінням `GET /api/streams/` через async lazy-load).
- [x] Streaming: в останньому кроці модалки кнопка “Створити” була нижче екрану (виправлено scroll/лейаутом модалки).
- [x] Docker: `runner` був `unhealthy` через некоректний healthcheck (вирівняно; тепер `runner` healthy).
- [x] Streaming: стрім міг “зависати” в статусі “Зупиняється” після планового stop (виправлено reconciler + parse supervisor статусу).
- [x] Streaming logs: занадто багато “frame=…” (виправлено `-nostats` + “important” режим за замовчуванням).
- [x] Library: у відео не було прев’ю (виправлено thumbnail_url + fallback `/thumbnails/{asset_id}.jpg`).
- [x] Рекомендації: bitrate/quality підказки були неточні (оновлено до актуальніших діапазонів, включно з 720p).
- [ ] i18n: в інтерфейсі місцями змішані мови (потрібен аудит ключів і заміна literal strings).
- [ ] Dashboard: екран перенавантажений — запропонувати спрощення/групування (collapsible/sections).
- [ ] Library UI: “важко і замудро” — запропонувати простіший вигляд (grid/list, сортування, пошук, швидкі фільтри).
- [ ] (додати) Опиши нову проблему 1 рядком + де її бачиш (URL/кроки/повідомлення в консолі).

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
- Прогнати і зафіксувати команди (див. `README.md` / `Makefile`):
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
**Статус:** ✅ виконано (2026-01-08) — stop‑scheduler додано.

**Зроблено**
- Додані stop‑поля для streams + логіка планового stop у scheduler.
- Додано UI для `stop_at` у builder/редакторі.

**AC**
- Якщо `stop_at` в минулому і стрім running → зупиняється.
- Scheduler не робить подвійний stop і не створює race conditions.

## A2. Timezone (на рівні UI/даних) (P0)
**Мінімально:** зберігаємо часи в UTC, у UI показуємо локально.  
**Опційно:** timezone per stream (потрібно для repeats у v1).

**Статус:** ✅ виконано (2026-01-08) — timezone профіль користувача додано.

**AC**
- Один і той самий стрім має однаковий час у різних браузерах (через збережений timezone або явний UTC‑показ).

## A3. Production runner для Docker/self‑host (P0)
**Ціль:** при рестарті FastAPI стріми не падають (у production‑режимі).

**Статус:** ✅ зроблено (2026-01-08 → 2026-01-09).

**Зроблено**
- У `docker/docker-compose.yml` є окремий сервіс `runner` (supervisord) + shared volumes для програм/логів.
- Додано коректний healthcheck для `runner` (не плутає “unhealthy” у Docker).

**Примітка (важливо для macOS/Docker Desktop)**
- У Docker керування `supervisorctl` іде через внутрішній HTTP endpoint (`runner:9001`) з `backend/supervisord.docker.conf`.
- Варіант з **unix socket** можливий на Linux (особливо якщо `/app/supervisord` — named volume), але на macOS bind-mount для unix sockets може працювати нестабільно.

**Ще треба (P0, найближче)**
- Для VPS/prod: або додати базову auth на supervisor HTTP API, або перейти на unix socket (Linux) — щоб не тримати “open control plane” навіть у внутрішній мережі.

**AC**
- Рестарт API не зупиняє стрім (в обраному production‑mode).

## A4. Політика видалення assets (P1)
**Що є:** delete блокується якщо asset використовується (409), `force=true` дозволяє “знести”.  
**Рішення для MVP:** safe delete як default (без soft delete), щоб не видаляти файли, які FFmpeg може ще відтворити.

**Статус:** ✅ виконано (2026-01-08) — safe delete в UI як default.

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

## A6. Streaming: коректні статуси (без “stopping” hang) (P0)
**Статус:** ✅ виконано (2026-01-09).

**Зроблено**
- Reconciler синхронізує не тільки `running/starting`, але й `stopping` (startup + periodic).
- Supervisor parse коректно розпізнає “process not found” як `NOT_FOUND`, щоб DB не зависала в `UNKNOWN`.
- `stopped_at` не виставляємо на `stopping` — тільки на фінальні `stopped|error`.

**AC**
- Стрім, який вже фактично зупинився, не може “висіти” у статусі “Зупиняється” довше ~10–20 сек.

## A7. Логи стрімів: “важливе” за замовчуванням (P1)
**Статус:** ✅ виконано (2026-01-09).

**Зроблено**
- Backend підтримує `mode=important|raw` для `GET /api/streams/{id}/logs`.
- UI: за замовчуванням показує “important” і дає перемикач “показати всі”.
- Підсвітка: лише `error` червоне, решта — сіре.

**AC**
- Логи не засмічені прогрес‑рядками, але показують помилки/причину падіння.

## A8. i18n: 3 мови всюди (uk/en/ru), default — українська (P1)
**Статус:** ⏳ (в роботі).

**Задачі**
- Пройтись по ключових екранах: `dashboard`, `library`, `streaming`, `login`, `plans`.
- Прибрати literal strings, замінити на `useTranslations()`.
- Прогнати `npm run i18n:check` і виправити missing keys.

**AC**
- UI не “стрибає” між мовами і не показує англомовні/російськомовні шматки в українському режимі.

## A9. Library: прев’ю + швидке оновлення списку після upload (P1)
**Статус:** ✅ виконано (2026-01-09).

**AC**
- Після upload файл з’являється в списку без ручного refresh.
- Для відео відображається прев’ю/thumbnail (або стабільний fallback).

## A10. UX‑спрощення: Dashboard + Library (P2)
**Задачі**
- Dashboard:
  - згрупувати “операційні” блоки і зробити їх collapsible/secondary,
  - залишити 1–2 ключові карти вгорі (Active streams, Storage, Quota).
- Library:
  - режим “простий” (grid з прев’ю) як default,
  - сортування (нові/старі, назва, тривалість, розмір),
  - швидкі фільтри (video/audio, warnings, in use).

**AC**
- На першому погляді зрозуміло “що відбувається”, без перевантаження UI.

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
