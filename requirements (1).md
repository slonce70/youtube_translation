# requirements.md — 24/7 YouTube Live Streaming Service (MVP → v1)

**Дата:** 2026-01-08  
**Документ для:** команди + AI‑помічника (виконання задач під вашим контролем)

---

## 0) TL;DR (що робимо і чому)

Мета: **бюджетний веб‑сервіс**, де користувач:

1) завантажує відео/аудіо (або підключає бібліотеку),  
2) збирає плейлист/колекцію,  
3) вставляє RTMP(S) ключ/endpoint (або підключає YouTube через OAuth у v1),  
4) натискає Start або ставить **таймер**,  
5) сервіс **надійно** тримає 24/7 трансляцію (reconnect, авто‑restart, health),  
6) дає базові **live‑контроли** (stop, next/skip, hot‑swap без даунтайму),  
7) обмежує ресурси (квоти, якість, storage) → щоб залишатись бюджетними.

Ключова стратегія економії:
- **Pre‑convert (“optimize once”) → stream copy‑mode** (мінімальний CPU),  
- контроль бітрейту/якості → контроль трафіку (egress).

---

## 1) Результати дослідження ринку (Gyre, Upstream, інші)

### 1.1. Що вже вважається “стандартом” у 24/7 SaaS
Сервіси 24/7 стрімінгу продають не сам FFmpeg, а:
- **швидкий onboarding** (не “йди в YouTube Studio і шукай ключі”, а “натисни Connect”),  
- **надійність** (авто‑reconnect, restart, резерв),  
- **плейлисти + розклади** (start/stop/повтори),  
- **керування під час ефіру** (jump/skip, редагування плейлиста на льоту),  
- **оптимізацію файлів** (конвертер/encoder),  
- (далі) overlays, команди/ролі, монетизаційні вставки.

### 1.2. Gyre — головні сигнали
- Позиціонує 24/7 як “швидкий шлях до монетизації”, має **multi‑platform**, **плейлисти**, **stream scheduler**, **вбудований конвертер**, watermark у trial та ліміти по storage/streams.  
- З 2025‑12 Gyre прямо підкреслює **повну автоматизацію через YouTube API (channel authorization)**, щоб прибрати ручну роботу зі stream keys і автоматизувати lifecycle (launch → stop), плюс згадує нюанс про монетизацію “streams created via third‑party tools”.

### 1.3. Upstream — головні сигнали
- Робить акцент на “cloud streaming без сервера” і **live‑керуванні**: scheduler start/stop + repeating schedules, backup streams, live playback controls, редагування плейлиста “на льоту”, separate audio/video, crossfade, teams, live studio/overlays, монетизація/ads вставки.

### 1.4. Інші сервіси (коротко)
- **OneStream Live**: має режим “24/7 Streaming” лише для YouTube і декларує ліміт “максимум 30 днів за один запуск” (тобто вони роблять long‑running session з власними обмеженнями).  
- **LoopingStream**: акцентує “Smart Encoder auto‑optimizes videos” — тобто автоматична оптимізація файлів як selling point.

### 1.5. Feature matrix (щоб не “вигадувати велосипед”)
> ✅ = є явно, ⚠️ = частково/обхідними шляхами, ❌ = немає/не фокус.

| Фіча | Gyre | Upstream | OneStream | LoopingStream | Наш репозиторій (з архіву) |
|---|---:|---:|---:|---:|---:|
| Upload + бібліотека | ✅ | ✅ | ✅ | ✅ | ✅ |
| Плейлисти | ✅ | ✅ | ✅ | ✅ | ✅ (media collections + playlists) |
| Scheduler start | ✅ | ✅ | ✅ | ✅ | ✅ (scheduled_start_time) |
| Scheduler stop + повтори | ⚠️ | ✅ | ⚠️ | ⚠️ | ❌ (потрібно додати) |
| YouTube OAuth / “Connect channel” | ✅ (через API) | ✅ | ⚠️ | ? | ❌ |
| Авто‑створення broadcast/stream через API | ✅ | ⚠️/✅ | ❌ | ❌ | ❌ |
| Built‑in converter / optimize | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ (є валідація, треба UX + pipeline) |
| Live playback controls (skip/jump) | ? | ✅ | ? | ? | ⚠️ (є hot‑swap, нема UX “skip/jump”) |
| Backup/failover streams | ? | ✅ | ? | ? | ⚠️ (можна реалізувати, зараз немає) |
| Multi‑platform | ✅ | ✅ | ✅ | ? | ✅ (будь-який RTMP destination) |
| Teams/roles | Enterprise | ✅ | ❌ | ❌ | ⚠️ (є admin/roles, але нема org/team) |
| Self‑hosted | ❌ | ❌ | ❌ | ❌ | ✅ |

### 1.6. Open‑source референси (для ідей, не “копіювати 1:1”)
- **ffplayout** (open source playout/24‑7 broadcaster): ідеї для JSON playlists, fillers, overlay, realtime control.
- **OpenBroadcaster**: broadcast automation з медіа‑менеджментом і плануванням.
- **datarhei Restreamer**: self‑hosted UI для restreaming (корисний як референс UX, але не “file‑to‑RTMP” ядро).

---

## 2) Аудит вашого поточного репозиторію (youtube_translation.zip)

> Нижче — **фактичний стан** по коду в архіві. Це важливо, бо у вас вже реалізовано багато “MVP‑штук”.

### 2.1. Що вже реалізовано (сильні сторони)
**Backend (FastAPI + SQLAlchemy + Postgres + Redis):**
- Авторизація/реєстрація через Supabase (email/password), профіль користувача, адмін‑інструменти.
- Сутності та API для:
  - **Assets** (відео/аудіо), метадані, сумісність,
  - **Media Folders** (менеджер папок),
  - **Media Collections** (плейлисти/колекції відео або аудіо),
  - **Destinations** (RTMP/RTMPS endpoint + stream key, зашифровано),
  - **Streams** (режим audio_only/video_only/mixed, якість, keyframe, playlist mode, шедулер старту),
  - **Stream Assets** (прив’язка активів до стріму),
- **Upload pipeline**: інтеграція з **tusd** (resumable uploads).
- **Streaming engine** на FFmpeg:
  - побудова плейлистів через concat,
  - підтримка audio_only / video_only / mixed,
  - fallback placeholders (black video / silent audio),
  - multi‑destination через `tee`,
  - автоперезапуск, health, логування, метрики,
  - “hot swap” через slot‑файли та fifo‑вікна.
- Базова **безпека**: CORS, CSRF middleware, rate limiting, audit logs, error handling, health checks.
- Базові **квоти/тарифи** закладені (tiers, limits).

**Frontend (Next.js + React):**
- Дашборд, бібліотека медіа, сторінки стрімів, UI для плейлистів/колекцій, upload через tus (Uppy).

**DevOps:**
- docker-compose з Postgres, Redis, backend, tusd, Caddy.

**Висновок:** ядро “менеджер файлів + вибір відео/аудіо + збереження + правильні команди + запуск” — **майже готове**.

### 2.2. Критичні прогалини (те, що додасть конкурентності та UX)
1) **Stop‑scheduler і повторювані розклади**  
   Є `scheduled_start_time`, але немає системного “зупини о X / через N годин” і daily/weekly повторів.

2) **YouTube OAuth + Live Streaming API**  
   Зараз destination — RTMP+key. Ринок рухається до “one‑click connect”.

3) **VOD‑friendly режим (≤12h) + авто‑рестарти**  
   Якщо стрім >12h, YouTube може не зберегти архів. Потрібна опція “auto‑restart під VOD”.

4) **Конвертер/оптимізатор на вході (Optimize once)**  
   Потрібен простий шлях: “приведи файли до правильного профілю”, щоб стрім був стабільний і дешевий.

5) **Live playback controls**  
   Є hot‑swap механіка, але потрібні UX + ендпоїнти: skip/jump/inject.

6) **Teams/Org (опційно)**  
   Для агентств — roles/permissions на рівні організації.

7) **Billing (не для MVP)**  
   У вас вже є “tiers/quotas”, але немає оплати.

---

## 3) Продуктові вимоги (Product Requirements)

### 3.1. Персони
- **Solo Creator**: 1 канал, 1–2 стріми, хоче “натиснув і працює”.
- **Radio/LoFi Channel**: аудіо‑стрім з постійним бекграунд‑відео + (пізніше) crossfade.
- **Agency/Network**: кілька каналів, команда, шаблони, масовий запуск.

### 3.2. MVP vs v1 vs Later
**MVP (обов’язково):**
- Файли: upload (resumable), library, базові метадані/сумісність.
- Плейлисти/колекції: порядок, shuffle, loop.
- Destination: RTMPS/RTMP + key, тест валідності.
- Stream: start/stop, status, авто‑reconnect, логування.
- Scheduler: **одноразовий старт по таймеру**.
- Обмеження ресурсів: 1–2 профілі якості, прості ліміти.
- Сповіщення: хоча б webhook/telegram/email “стрім впав”.

**v1 (конкурентність):**
- Scheduler: start+stop + повтори (daily/weekly) + timezone.
- YouTube Connect (OAuth) + API‑створення liveStream/liveBroadcast + bind + transition.
- Optimize pipeline на вході (transcode to stream‑ready profile).
- Live controls: skip/jump, hot‑swap UI, emergency clip, “backup mode”.
- VOD segmentation (опція ≤12h).

**Later:**
- Overlays/templates (lower thirds, clock, ticker).
- Crossfade/normalization для аудіо.
- Teams/Org/RBAC.
- Billing + self‑serve plans.

---

## 4) Functional Requirements (детально)

> Формат: **FR‑xxx** + acceptance criteria.

### FR‑001. Акаунт та сесія
- Користувач може зареєструватися/увійти, бачити свої стріми/файли.
- Всі ресурси мають `user_id` (multi‑tenant).

**AC:**
- Неможливо отримати доступ до assets/streams іншого user_id.
- Rate limiting на auth endpoints.

### FR‑010. Менеджер файлів (Assets)
- Upload великих файлів (resumable), показ прогресу, пауза/резюм.
- Після upload: автоматичне читання тех.метаданих (ffprobe) + позначення сумісності.
- CRUD: rename, move folder, delete (з безпечним cleanup).
- Пошук і фільтри (type, duration, resolution).

**AC:**
- Upload файлу 5–20GB не ламається на поганому інтернеті (resume працює).
- Файл без аудіо/без відео правильно позначається (для mixed режимів).

### FR‑020. Колекції / плейлисти
- Колекція = впорядкований список assets (video або audio).
- Режими: `sequential`, `shuffle`, `loop`, `shuffle_loop`.

**AC:**
- Зміна порядку елементів оновлює відтворення (в v1 — без рестарту).

### FR‑030. Destinations
- Destination містить:
  - `name`, `platform` (youtube/custom),
  - `rtmp_url` (або вибір ingest),
  - `stream_key` (шифрування + masked у UI),
  - default RTMPS.
- “Test destination” перевіряє валідність URL (і опційно TCP connect).
- В v1: OAuth destinations (YouTube channel tokens).

**AC:**
- Stream key ніколи не віддається у відкритому вигляді через API.

### FR‑040. Streams (ядро)
- Stream має:
  - `name`, `mode` (video_only/audio_only/mixed),
  - посилання на video_collection + audio_collection (залежно від режиму),
  - `quality_profile` (720p/1080p/4K), `bitrate`, `fps`,
  - `destinations[]`,
  - `status` (draft/scheduled/running/error/stopped),
  - `scheduled_start_time` (MVP), `scheduled_end_time` (v1),
  - `last_error`, `last_heartbeat`.
- Start/Stop.

**AC:**
- Якщо FFmpeg процес падає — система сама відновлює (backoff).
- Статус у UI змінюється ≤10 сек після події.

### FR‑050. Scheduler та автоматизація
**MVP:** одноразовий старт.  
**v1:**  
- start + stop, stop_after_duration, повтори:
  - daily window (08:00–23:00),
  - weekly schedule,
  - timezone per stream.
- Опція VOD segmentation (restart кожні 11:50–11:59).

**AC:**
- Планувальник не запускає стрім двічі (idempotent).
- Stop гарантовано вбиває процес.

### FR‑060. Live playback controls (v1)
- Skip current item
- Jump to item
- Inject emergency clip
- Reload playlist (hot‑swap)

**AC:**
- Skip без чорного екрану довше 1–2 сек (ціль).
- Emergency clip має пріоритет.

### FR‑070. Конвертер/Оптимізатор (v1)
- “Optimize for YouTube”:
  - транскод до стандартного профілю (H.264/AAC, yuv420p, контроль GOP),
  - генерація thumbnail,
  - опційно loudness normalize.
- Після оптимізації стрім запускається у copy‑mode (де можливо).

**AC:**
- Після оптимізації файл позначається “stream-ready”.
- Copy‑mode працює стабільно.

### FR‑080. Observability
- Логи FFmpeg по стріму (tail у UI).
- Метрики: active streams, restarts, exit codes.
- Алєрти: “stream down > N min”.

**AC:**
- Alert ≤60 сек від падіння.

---

## 5) Non‑Functional Requirements (NFR)

### NFR‑001. Бюджетність (Cost-aware)
- Pre‑convert → copy‑mode.
- Ліміти якості/бітрейту залежно від plan.
- Ліміти concurrent streams.

### NFR‑010. Надійність
- Авто‑restart з backoff + max retries + circuit breaker.
- Watchdog/heartbeat.

### NFR‑020. Безпека
- Шифрування stream keys / refresh tokens.
- Мінімальний доступ до секретів.
- Audit log.

### NFR‑030. Масштабування
- MVP: один сервер.
- v1+: worker service + queue + object storage.

---

## 6) Архітектура (рекомендована)

### 6.1. MVP (self-hosted)
- **Frontend:** Next.js
- **Backend:** FastAPI
- **DB:** Postgres
- **Uploads:** tusd + backend hooks
- **Streaming:** FFmpeg процеси (керовані backend)
- **Reverse proxy:** Caddy / Nginx

### 6.2. v1 (розділення control plane vs data plane)
- API: CRUD/control
- Workers: FFmpeg runners
- Queue: Redis
- Storage: S3/MinIO

---

## 7) Специфікація FFmpeg (пресети і “правильні команди”)

### 7.1. Базові режими
- **video_only:** відео‑плейлист; якщо нема аудіо → silent.
- **audio_only:** аудіо‑плейлист + фон/плейсхолдер відео.
- **mixed:** video_collection + audio_collection (мапінг video з одного input, audio з іншого).

### 7.2. Key правила
- GOP/keyframe interval: 2s default (параметризовано).
- Copy‑mode тільки для “stream-ready” файлів.
- Multi-destination: або tee+re-encode, або 1 ffmpeg per destination.

---

## 8) YouTube API інтеграція (v1)

### 8.1. Навіщо
- Менше ручної роботи зі stream keys.
- Можна автоматично створювати/оновлювати стріми (title/desc/thumb).
- Краще для multi‑channel.

### 8.2. Що реалізувати
- Google OAuth2 (web), scopes для YouTube.
- Зберігання refresh token (encrypted).
- Виклики YouTube Live Streaming API:
  - `liveStreams.insert`,
  - `liveBroadcasts.insert`,
  - `liveBroadcasts.bind`,
  - `liveBroadcasts.transition` (start/stop).

---

## 9) Дані / БД (що додати)

### 9.1. Streams
- `scheduled_end_time TIMESTAMPTZ NULL`
- `stop_after_seconds INT NULL`
- `timezone VARCHAR(64) DEFAULT 'UTC'`
- `recurrence_rule TEXT NULL` (RRULE) або JSON
- `vod_segment_minutes INT NULL` (напр. 710)
- `auto_restart_enabled BOOLEAN DEFAULT TRUE`

### 9.2. Destinations
- `platform` (youtube/custom)
- `oauth_provider` (google)
- `oauth_refresh_token_encrypted`
- `youtube_channel_id`
- `youtube_default_broadcast_settings JSONB`

---

## 10) План робіт (AI‑friendly backlog)

### Phase A — стабілізація MVP
1) Scheduler: `scheduled_end_time` + stop job.
2) UI: статус + лог tail.
3) Cleanup: delete assets без сиріт.
4) Dependency refresh (мінімальний) + smoke tests.
5) Документація деплою + “first stream”.

### Phase B — v1 “конкурентність”
1) YouTube OAuth + API create/bind/transition.
2) Optimize pipeline (transcode to stream‑ready).
3) VOD segmentation (restart under 12h).
4) Live controls: skip/jump/inject.

---

## 11) Рекомендації по залежностях (станом на 2026-01-08)
- **FastAPI**: перевірити апдейт до актуальної stable (на PyPI видно нові релізи).  
- **Pydantic**: перевірити апдейт до актуальної stable.  
- **Next.js 15** офіційно stable і готовий для production (але важливо тримати узгоджені версії React/типів).  
- Підхід: оновлювати мінімально (по одному пакету) + проганяти smoke tests.

---

## 12) Що НЕ робимо зараз (щоб не ускладнювати)
- Drag‑and‑drop overlay designer як у топ‑SaaS.
- Повноцінний billing/self‑serve.
- Kubernetes/мікросервіси без реального навантаження.

---

## 13) Посилання (для команди)
- Gyre: https://gyre.pro/  
- Gyre (YouTube API automation update): https://gyre.pro/blog/gyre-update-full-automation-of-live-streams-via-the-youtube-api  
- Upstream: https://upstream.so/  
- Upstream features: https://upstream.so/features/  
- Upstream help (limits/VOD/12h): https://help.upstream.so/  
- OneStream Live help (24/7 streaming): https://support.onestream.live/  
- LoopingStream: https://loopingstream.com/  
- YouTube Help (encoder settings): https://support.google.com/youtube/answer/2853702  
- YouTube Help (archive live streams <12h): https://support.google.com/youtube/answer/6247592  
- YouTube Live Streaming API docs: https://developers.google.com/youtube/v3/live  
- ffplayout (open source): https://github.com/ffplayout/ffplayout  
- OpenBroadcaster: https://openbroadcaster.com/  
- datarhei Restreamer: https://github.com/datarhei/restreamer

