# Requirements: веб‑сервіс для 24/7 YouTube (RTMPS) трансляцій з плейлистами та таймером

**Версія:** 0.1 (draft)  
**Дата:** 2026‑01‑08  
**База для документа:**  
- аудит вашого поточного проєкту з архіву `youtube_translation.zip` (backend+frontend+docker)  
- аналіз конкурентів/ринку: Gyre, Upstream та інші сервіси 24/7 трансляцій; огляд відкритих проєктів (open‑source)

> Цей документ написаний так, щоб **LLM/AI могла реалізовувати задачі частинами** під вашим контролем: багато чітких acceptance criteria, структури даних, edge‑cases та “Definition of Done”.

---

## 1) Контекст і ціль продукту

### 1.1. Проблема, яку вирішуємо
Користувачі хочуть **запускати 24/7 live‑трансляції на YouTube** (та потенційно інших платформах) з **попередньо записаних відео/аудіо**, без OBS і без постійно увімкненого ПК, з можливістю:
- завантажити медіа в “бібліотеку” (менеджер файлів);
- зібрати плейлист(и);
- обрати RTMPS destination (YouTube ingest + stream key);
- запустити/зупинити стрім вручну або **по таймеру**;
- бачити статус, логи, помилки, авто‑відновлення.

### 1.2. Product Goals (MVP)
1) **Надійно** тримати стріми онлайн 24/7 (авто‑reconnect, авто‑restart).  
2) Дати простий UX: **Library → Playlist → Destination → Stream → Schedule → Go Live**.  
3) **Дешево**: мінімізувати CPU/трафік, зробити прогнозоване навантаження та обмеження по тарифах.  
4) **Multi‑tenant**: кілька користувачів на одній інсталяції (SaaS/“для різних користувачів”).  
5) Без зайвого оверхеду на старті: все, що не критично для запуску — у Phase 2+.

### 1.3. Non‑Goals (на старті)
- Повноцінний “Canva/Figma‑рівень” дизайнер сцен як в Upstream (це окремий великий продукт).
- YouTube‑Verified encoder або глибока інтеграція з YouTube API як must‑have.
- Складна білінг‑система (Stripe) — на MVP можна обійтись ручним призначенням тарифів.

---

## 2) Ринок і “що очікує користувач”

### 2.1. Gyre.pro (що важливо для нас)
Gyre позиціонується як сервіс для **24/7 трансляцій з pre‑recorded відео**, з:
- завантаженням відео на сервер сервісу;
- програванням вибраних файлів та **loop плейлиста**;
- можливістю запускати **кілька одночасних стрімів** (вказують до 8 залежно від плану);
- акцентом “**не потрібен доступ до каналу**” (достатньо ingest+key).  
Також у тарифах фігурує “video converter / playlists / scheduler” як ключові features. (Джерело: gyre.pro)

**Інсайт:** “не потрібен доступ до каналу” — дуже важливий для конверсії (менше страхів). Тому MVP має працювати **без YouTube OAuth**: користувач вводить RTMPS URL + stream key.

### 2.2. Upstream.so (що важливо для нас)
Upstream описує себе як cloud‑платформу для 24/7 стрімів, з сильним фокусом на:
- **drag‑and‑drop overlays** (Stream Designer);
- **multistream до ~10 платформ**;
- **schedule start/stop**, у т.ч. repeat daily;
- live playback controls, on‑the‑fly playlist changes;
- окремі audio/video плейлисти + secondary audio + crossfade;  
- backup streams для безперервності. (Джерело: upstream.so)

**Інсайт:** 80% користі для “бюджетного” MVP дають:
- playlist + scheduling + авто‑відновлення + простий UI,
а дизайнер/overlays можна робити “template‑based” у Phase 2.

### 2.3. Інші сервіси (патерни)
Більшість альтернатив теж продають одне й те саме ядро:
- “upload → playlist → loop → schedule → 24/7”,
а ще часто: auto‑optimize/convert під стрім (smart encoder), multistream, імпорт з Google Drive/Dropbox тощо.

### 2.4. Open‑source референси (корисні ідеї)
- **datarhei/core / Restreamer** — “process management for FFmpeg” + API, логи, статистика, resource limiting, Docker‑оптимізація. Це гарний референс як правильно робити керування процесами FFmpeg.  
- **comfy-channel** — приклад 24/7 плейауту з overlay та автоматичним вибором контенту (Python+FFmpeg).  
- “youtube-live-stream-manager” та схожі репозиторії — приклади базового веб‑менеджменту плейлистів.

---

## 3) Аудит вашого поточного проєкту (as‑is)

> Нижче — **що вже зроблено** у вашому репозиторії (архів), що співпадає з MVP, і що варто поправити/добити.

### 3.1. Що вже є (сильні сторони)
**Інфраструктура**
- Docker Compose: backend, frontend, Postgres, Redis, tusd (resumable uploads), Caddy reverse‑proxy.
- Базові healthchecks/ports/volumes.

**Backend (FastAPI)**
- Auth через Supabase JWT, кешування user payload, dev‑auth fallback.
- Модулі: assets, playlists, destinations, streams, media_folders, media_collections, quota, admin, metrics.
- Шифрування stream key (Fernet+PBKDF2), маскування key у UI.
- Валідація медіа через ffprobe, збереження метаданих, thumbnails.
- Quota/tiers (ліміти: streams, storage, bitrate/resolution, runtime тощо).

**Streaming engine**
- FFmpegManager з побудовою команд під:
  - video_only / audio_only / mixed (окремі audio/video collections);
  - placeholders якщо немає треків;
  - RTMPS output + оптимізації буферів;
  - multistream через `tee` muxer;
  - auto‑recovery, monitor process, log capture, status updates.
- Hot‑swap механіка (slot files) для live‑оновлення плейлиста.
- Scheduler/launcher для старту за часом (поля schedule у БД).

**Frontend (Next.js)**
- Кабінет з Library (folders/collections), Playlists, Streaming pages.
- Завантаження через tus (Uppy).
- Багатомовність (i18n), дизайн‑система компонентів.

### 3.2. Що виглядає “overkill” для MVP (можна відкласти)
- Розширений admin panel (якщо ви не робите SaaS прямо зараз).
- Gamification/маркетингові екрани, якщо вони відволікають від ядра.
- Дуже складні quota‑політики — можна залишити базові: max streams + max storage.

### 3.3. Найважливіші ризики/прогалини
1) **Надійність при рестарті backend**  
   Якщо FFmpeg процеси живуть всередині backend‑процесу (mode=manager), при падінні/деплої все падає.  
   У вас вже є режими `supervisor/systemd` — це хороша ідея, але треба чітко описати “production default”.

2) **Вартість CPU (ре‑енкодинг)**
   Для дешевого сервісу критично:  
   - або максимально **-c copy** (stream copy) з готових H.264/AAC файлів;  
   - або робити **офлайн “Smart Encoder/Converter”** при завантаженні (як Gyre/LoopingStream), щоб в runtime майже все було copy.

3) **Функціональне покриття file manager**
   UI/моделі є, але треба чітко визначити MVP‑поведінку:
   - папки;
   - теги/пошук;
   - типи (video/audio/image);
   - batch‑операції;
   - policy видалення: “не можна видалити asset який у playlist/stream” або “soft delete”.

4) **Безпека multi‑tenant**
   - Ізоляція шляхів на диску (user_id в шляхах) — має бути жорстка.
   - Rate limits на upload/stream control endpoints.
   - Обовʼязкове шифрування ключів + секретів в env.

### 3.4. Швидкі перемоги (quick wins)
- Зробити “MVP mode”: вимкнути все зайве фічефлагами, залишити ядро.
- Додати “Stream presets” (720p/1080p) з правильними дефолтами.
- Додати “Safe FFmpeg templates” + тестовий режим (dry‑run + ffprobe checks).
- Документація “як взяти stream key у YouTube”.

---

## 4) Функціональні вимоги (Product Requirements)

### 4.1. Мінімальний user flow (MVP)
1) User логіниться/реєструється.
2) Йде в **Library** → створює папку → завантажує відео/аудіо/картинки.
3) Створює **Collection** (набір відео або аудіо) або одразу **Playlist**.
4) Створює **Destination**:
   - тип: YouTube (RTMPS)
   - server url (дефолт)
   - stream key (зберігаємо encrypted)
5) Створює **Stream**:
   - вибір: video collection + (optional) audio collection
   - output: destination (або список destinations)
   - параметри якості (preset)
   - loop mode, shuffle
6) Натискає **Start** або ставить **Schedule**:
   - start_at, (optional) stop_at
   - (optional) repeat (daily/weekly)
7) Бачить:
   - статус (starting/online/error/stopped)
   - поточний playing item
   - логи останні N рядків
   - кнопку stop

### 4.2. Модулі та вимоги

#### 4.2.1. Auth & Account
**MVP must:**
- JWT auth (Supabase або власний) — вже є.
- Авто‑створення user_profile при першому вході — вже є.
- Профіль: email, name, timezone.

**Nice to have:**
- Team access/roles (viewer/editor/manager) як у Upstream — Phase 3.

**Acceptance критерії**
- Без токена жоден приватний endpoint не працює.
- User бачить лише свої assets/streams/destinations.

#### 4.2.2. Plans / Quotas (для бюджету)
**MVP must:**
- Ліміт **кількості одночасних стрімів**.
- Ліміт **storage (GB)**.
- (Optional) ліміт max resolution/bitrate per plan.

**Nice to have:**
- Авто‑білінг (Stripe) — Phase 2/3.
- Ліміт CPU/Memory per stream (як у datarhei/core) — Phase 2.

**Acceptance**
- Коли ліміт перевищено — UI показує причину, backend повертає понятну помилку.
- Storage quota рахується точно (sum asset sizes).

#### 4.2.3. Library / Asset Manager (менеджер файлів)
**MVP must:**
- Resumable uploads (tus) — вже є.
- Папки (MediaFolder): create/rename/move/delete.
- Asset list з фільтрами: type, folder, search by name.
- Asset metadata:
  - duration, resolution, fps, codecs
  - file size
  - thumbnails для відео (опц.)
- Asset actions:
  - delete (soft або hard, але з правилами)
  - rename
  - move між папками

**Rules**
- Тільки whitelist типів (mp4, mov, mkv, mp3, wav, jpg/png).
- Максимальний розмір файлу залежить від plan.
- Якщо asset використовується в active stream:
  - або заборонити delete;
  - або “mark for deletion after stream end”.

**Acceptance**
- Після upload asset з’являється в бібліотеці з коректними метаданими.
- Нема path traversal / user не може бачити чужі файли.

#### 4.2.4. Collections & Playlists
Термінологія (рекомендовано):
- **Collection** = набір файлів одного типу (video або audio). Це зручно для “separate audio/video playlists”.
- **Playlist** = порядок програвання (може посилатись на collections або на конкретні assets).

**MVP must:**
- Create/update/delete playlist.
- Додавання елементів, reorder (drag&drop), shuffle (опц.), loop.
- Playlist item поля:
  - asset_id
  - order
  - start_offset (optional, Phase 2)
  - end_offset (optional, Phase 2)
  - weight/priority (optional)

**Live update (дуже бажано)**
- Додавання/видалення/перестановка під час активного стріму без повного стопу (у вас вже є hot‑swap).

**Acceptance**
- Плейлист відтворюється по порядку і циклічно.
- При live update зміни застосовуються протягом ≤ 30 сек без обриву стріму.

#### 4.2.5. Destinations (YouTube/RTMP)
**MVP must:**
- Destination тип “YouTube RTMPS”.
- Поля:
  - name
  - rtmps_url (default: `rtmps://a.rtmp.youtube.com/live2`)
  - stream_key (encrypted at rest)
- Support custom RTMP/RTMPS для інших платформ (опц).

**Acceptance**
- Stream key ніколи не повертається в UI у відкритому вигляді.
- Destination тест‑кнопка (Phase 2): “перевірити з’єднання” (tcp connect) без старту стріму.

#### 4.2.6. Streams (core)
**MVP must:**
- CRUD stream.
- Start/Stop.
- Status:
  - stopped / starting / live / error / reconnecting
- Logs:
  - останні N рядків, live tail через websocket
- Config:
  - source_mode: video_only | audio_only | mixed
  - video_source: playlist/collection
  - audio_source: playlist/collection (optional)
  - output destinations: 1..N
  - preset: 720p/1080p + fps + bitrate
  - loop: on/off
  - shuffle: on/off
  - restart_policy: always / on-failure
- Schedule:
  - start_at (datetime, tz aware)
  - stop_at (optional)
  - repeat: none | daily | weekly (Phase 2)
- Now playing:
  - current_video_asset_id, current_audio_asset_id (optional)
  - started_at, elapsed

**Acceptance**
- Натиснув Start → протягом “розумного” часу (≤ 30–60 сек) отримуємо stable “live”.
- При падінні FFmpeg процеса — auto restart (якщо restart_policy).
- Stop зупиняє процес за ≤ 10 сек.

#### 4.2.7. Scheduler (таймер)
**MVP must:**
- 1‑разовий start_at, stop_at.
- Планувальник (окремий background task або worker) сканує schedule і запускає.
- Idempotency: якщо scheduler двічі триггернув — стрім не запускається двома процесами.

**Phase 2**
- Repeating schedule daily/weekly (як у Upstream).
- “Restart stream every X hours” (корисно для YouTube архівації <12h).

**Acceptance**
- Якщо час старту минув і стрім був stopped → стартує.
- Якщо стрім already running → scheduler не робить нічого.

#### 4.2.8. Monitoring & Metrics
**MVP must:**
- Health endpoints.
- Prometheus metrics (у вас є).
- В UI: basic indicator CPU/ram per stream (можна без точності на MVP).

**Phase 2**
- Alerting: email/webhook при падінні стріму.

---

## 5) Нефункціональні вимоги (NFR)

### 5.1. Надійність
- Target uptime для active streams: **99%+** (на практиці: авто‑reconnect + auto‑restart).
- Будь‑який деплой не має “вбивати” стріми, якщо ви хочете 24/7 → потрібен supervisor/systemd/worker separation.

### 5.2. Продуктивність і бюджет
- MVP ціль: **1 сервер = кілька стрімів**.
- Пріоритет: **stream copy** там, де можливо, бо ре‑енкодинг дорогий.
- Якщо потрібен енкодинг:
  - бажано мати GPU‑профілі (NVENC/VAAPI) як Phase 2.

### 5.3. Безпека
- Stream keys encrypted at rest.
- Мінімальний доступ сервісів (principle of least privilege).
- Rate limiting на auth/upload/stream control.
- Захист від SSRF через custom RTMP URLs (валідація схем/host allowlist опц).

### 5.4. Сумісність з YouTube ingest
Орієнтуємось на офіційні рекомендації YouTube для RTMP/RTMPS:
- Protocol: RTMP/RTMPS
- Video codec: H.264
- Audio codec: AAC або MP3
- Keyframe interval: **2 секунди**, не більше 4
- Bitrate encoding: CBR
- YouTube також рекомендує RTMPS. (Джерело: support.google.com/youtube)

---

## 6) Технічні вимоги та рекомендації по стеку

### 6.1. Рекомендований MVP стек (мінімум змін від вашого)
**Backend:** Python 3.11+, FastAPI, SQLAlchemy async, Postgres  
**Streaming:** FFmpeg (в контейнері) + ffprobe  
**Uploads:** tusd + hooks (вже є)  
**Cache/locks:** Redis (вже є)  
**Frontend:** Next.js (App Router)  
**Proxy:** Caddy або Nginx

> Ваш стек вже адекватний для MVP. Головне — не “переписувати все”, а довести ядро до production‑готовності.

### 6.2. Рекомендована runtime архітектура (production)
**Варіант A (простий, але менш надійний):** FFmpeg процеси як subprocess всередині backend  
- + швидко  
- – при рестарті backend все падає

**Варіант B (рекомендовано):** окремий “stream‑runner” layer
- backend: API + DB  
- worker/runner: supervisor запускає `python -m app.cli.run_stream <stream_id>`  
- backend керує runner через supervisor API/ctl (у вас вже є заготовки)

**Варіант C (майбутнє/scale):** винести streaming у окремий сервіс (Go/Rust) або інтегрувати datarhei/core
- + зрілий процес‑менеджмент, resource limits, API
- – інтеграція та multi‑tenant складніше

### 6.3. Зберігання файлів
**MVP (дешево):** локальний диск (volume) + user‑scoped directories  
**Phase 2:** S3‑compatible storage (MinIO/Backblaze) + CDN (опц)

**Правило:** стрімінг з object storage може бути дорогим по egress; для бюджету часто вигідніше тримати “hot” контент на локальному SSD.

---

## 7) FFmpeg: стандартизовані “правильні команди” (templates)

> Нижче — шаблони команд і параметрів. Реальні команди формуються кодом, але важливо мати **єдині пресети** та правила.

### 7.1. Template: video playlist → RTMPS (copy first)
- Вхід: concat demuxer file list
- Якщо файл(и) вже H.264/AAC, yuv420p, правильний GOP → **-c copy**
- Інакше fallback на re‑encode.

Ключові параметри:
- `-re` (читати як realtime)
- `-fflags +genpts`
- `-use_wallclock_as_timestamps 1`
- `-vsync cfr`
- `-r 30` або 60 (preset)
- `-g 60` для 30fps (2s GOP), `-g 120` для 60fps
- `-keyint_min` == `-g`
- `-sc_threshold 0`
- `-b:v`, `-maxrate`, `-bufsize` (CBR-ish)
- `-b:a 128k` або 192k
- `-f flv` для RTMP

### 7.2. Template: audio‑only “radio” (static image)
- Вхід: audio playlist + loop image
- Відео: `-loop 1 -i cover.jpg` + scale/pad
- Аудіо: `-stream_loop -1 -i audio.mp3` або concat audio list
- Вихід: H.264 + AAC (бо YouTube ingest любить відео)

### 7.3. Mixed mode: video loop + audio loop (separate playlists)
- Відео йде циклом незалежно від аудіо
- Можливий drift → потрібні правила синхронізації:
  - simplest: `-shortest` не підходить (бо 24/7)
  - краще: аудіо як master clock, відео loop; або навпаки
- Phase 2: додати crossfade (afade/amix across tracks)

### 7.4. Multistream (tee muxer)
- `-f tee "[f=flv]rtmps://...|[f=flv]rtmps://..."`
- Уникати різних кодеків per destination (один pipeline).

---

## 8) Модель даних (рекомендована)

> У вас більшість моделей вже є. Тут — “канонічний” варіант, щоб AI не ламала структуру.

### 8.1. Entities
- **UserProfile**
  - user_id (uuid, PK)
  - email, full_name
  - timezone
  - subscription_tier, subscription_status
- **MediaFolder**
  - id, user_id, parent_id, name
- **Asset**
  - id, user_id, folder_id
  - type: video|audio|image
  - path, size_bytes
  - metadata_json (duration, codecs, width/height, fps)
  - created_at
- **Collection**
  - id, user_id, type: video|audio|image?
  - name
- **CollectionItem**
  - collection_id, asset_id, order
- **Destination**
  - id, user_id
  - name
  - rtmps_url
  - stream_key_encrypted
- **Stream**
  - id, user_id
  - name
  - source_mode (video_only|audio_only|mixed)
  - video_collection_id (nullable)
  - audio_collection_id (nullable)
  - destinations (many-to-many або json list)
  - preset (resolution/fps/bitrate)
  - status (stopped/starting/live/error)
  - schedule_start_at, schedule_stop_at
  - repeat_rule (nullable)
  - created_at
- **StreamRuntime**
  - stream_id
  - pid/runner_id
  - last_heartbeat
  - last_error
  - now_playing_asset_id
  - metrics snapshot (optional)

### 8.2. Constraints
- user_id scope everywhere.
- FK cascade rules визначити явно (особливо delete assets).

---

## 9) API контракт (MVP)

> Тут не “всі” endpoints, а мінімальний контракт, щоб фронт і бек розвивались синхронно.

### 9.1. Assets
- `POST /api/assets/upload-token` (tus)
- `GET /api/assets?folder_id=&type=&q=`
- `DELETE /api/assets/{id}`
- `PATCH /api/assets/{id}` (rename/move)

### 9.2. Folders/Collections
- `POST /api/media-folders`
- `GET /api/media-folders/tree`
- `POST /api/media-collections`
- `GET /api/media-collections?type=`
- `POST /api/media-collections/{id}/items` (batch add)
- `PATCH /api/media-collections/{id}` (reorder)

### 9.3. Destinations
- `POST /api/destinations`
- `GET /api/destinations`
- `DELETE /api/destinations/{id}`

### 9.4. Streams
- `POST /api/streams`
- `GET /api/streams`
- `POST /api/streams/{id}/start`
- `POST /api/streams/{id}/stop`
- `GET /api/streams/{id}/status`
- `GET /api/streams/{id}/logs?lines=`
- `PATCH /api/streams/{id}/live-config` (live update playlist/config)
- WS: `/api/streams/ws/status` + `/api/streams/ws-token`

---

## 10) Roadmap (що робимо в якій черзі)

### Phase 1 — MVP “працює і не падає”
- Library: upload, folders, list, delete safety.
- Playlists/Collections: create, reorder, loop.
- Destinations: YouTube RTMPS, encrypted keys.
- Streams: create, start/stop, status, logs.
- Scheduler: start_at, stop_at (one-shot).
- Production runner: supervisor mode default.
- Документація для юзера: “як взяти stream key”, “як підготувати відео”.

### Phase 2 — “дешево і масштабовано”
- Smart Encoder / Converter pipeline (transcode on upload) → runtime copy.
- Repeating schedules + “restart every N hours”.
- Multi‑destination UI + plan gating.
- Basic overlays templates (logo + now playing).
- Alerts: email/webhook.

### Phase 3 — “як Upstream”
- Stream designer (editor) або інтеграція з template engine.
- Team access/roles.
- Live studio ingress (RTMP/HLS input).
- Backup streams.
- Stripe billing.

---

## 11) Backlog задач у форматі “AI‑friendly”

> Кожна задача нижче сформульована так, щоб її можна було напряму давати AI як окремий таск.

### 11.1. [MVP] Документація користувача “YouTube ingest”
**Goal:** сторінка/модалка в UI з інструкцією “де знайти RTMPS URL і Stream key” + попередження про 12h VOD.  
**DoD:**  
- Додати help‑секцію на сторінці Destinations.  
- Текст: пояснити, що сервіс може стрімити 24/7, але YouTube автоматично архівує лише стріми <12 годин (інакше може не зберегтись).  
- Лінк на офіційний YouTube Help (в документації проєкту).  
**Test:** ручна перевірка, що юзер бачить це без логіна в YouTube через API.

### 11.2. [MVP] Production default: supervisor runner
**Goal:** зробити так, щоб у production стріми не падали при перезапуску backend.  
**DoD:**  
- У docker compose додати окремий service `runner` або налаштувати supervisor всередині backend контейнера (але стабільно).  
- Backend при `start_stream` створює supervisor program конфіг та запускає.  
- При рестарті backend: reconcile повертає статуси і підʼєднується до вже працюючих процесів.  
**Test:**  
- Запустити стрім, рестартнути backend контейнер → стрім продовжує йти.

### 11.3. [MVP] Asset delete safety (soft delete)
**Goal:** не ламати active streams і плейлисти.  
**DoD:**  
- Додати поле `deleted_at` у assets.  
- `DELETE /assets/{id}` робить soft delete.  
- Якщо asset використовується в active stream — позначаємо як pending deletion.  
- Garbage collector job чистить фізичні файли раз на добу.  
**Test:**  
- Запустити стрім з asset, видалити asset → стрім не падає.

### 11.4. [Phase 2] Smart Encoder pipeline
**Goal:** при завантаженні або по кнопці “Optimize” робити трансформацію в “stream‑ready” формат (H.264/AAC, correct GOP), щоб streaming був `-c copy`.  
**DoD:**  
- Job queue (можна простий background worker + Redis).  
- Зберігати derivative file + metadata.  
- UI показує статус: “Optimizing… / Ready”.  
**Test:**  
- До optimize: stream uses re-encode.  
- Після optimize: stream uses copy, CPU падає.

### 11.5. [Phase 2] Repeat schedule + restart every N hours
**Goal:** підтримати daily/weekly schedule і автоперезапуск.  
**DoD:**  
- Розширити модель stream: repeat_rule (RRULE-like або простий enum + time).  
- Scheduler виконує start/stop по правилах.  
- Опція “restart every 11h50m” для архівування.  
**Test:** симуляція часу (mock) + integration test.

---

## 12) Ризики і як їх мінімізувати

1) **YouTube політики / контент**
   - Не позиціонувати продукт як “hack алгоритмів”.
   - Додати ToS та політику “користувач відповідає за права на контент”.

2) **Вартість інфраструктури**
   - Пріоритет на copy streaming і/або encoder pipeline.
   - Ліміти per plan (streams, storage, max bitrate).

3) **Стабільність FFmpeg**
   - Process isolation + restart policy.
   - Логи + автоматичне виявлення “stuck” (no progress).

---

## 13) Appendix: посилання/референси (для команди)
- Gyre (24/7 pre‑recorded live streams, playlists/scheduler, “channel access not required”): https://gyre.pro/  
- Upstream features overview (schedule repeat, multistream, overlays, separate audio/video playlists): https://upstream.so/upstream-features/  
- YouTube Help: archive live streams (<12h): https://support.google.com/youtube/answer/6247592  
- YouTube Help: encoder settings, keyframe 2s, RTMPS recommended: https://support.google.com/youtube/answer/2853702  
- datarhei/core (FFmpeg process management API): https://github.com/datarhei/core  
- comfy-channel (24/7 playout + overlays): https://github.com/mvarhola/comfy-channel  

