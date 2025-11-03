
# requirements.md — Вебсервіс «24/7 YouTube Restream із файлів без перекодування»

> **Мета**: спроєктувати мінімалістичний самохостинговий сервіс, який дозволяє авторизованому користувачу(ям) запускати **безперервні 24/7 трансляції** заздалегідь підготовлених відеофайлів на **кілька YouTube‑каналів одночасно** (симулькаст) **без перекодування** (`-c copy`) з **низьким CPU** та простим веб‑інтерфейсом.
>
> **Ключові умови**: простота, безкоштовні або відкриті компоненти, один «дедік» для серверної частини, ізоляція даних користувачів, контроль кожного потоку (start/stop/статус/логи).

---

## 0) Рішення після аналізу альтернатив (підсумок)

Після порівняння двох досліджень і перевірки документації ми приймаємо такі **остаточні рішення**:

- **Відеоядро** — **FFmpeg**: `-re` (читання у реальному часі), `-c copy` (без рекоду), **`tee` muxer** для мультивиходу, **`concat` demuxer** для плейлистів, **`fifo` muxer** з `attempt_recovery=1` для стійкості при мережевих розривах.  
  ⚠️ Самопосилання `playlist.txt` для «нескінченного» лупу **забороняється** — це призводить до витоку дескрипторів/ресурсів. Нескінченність забезпечуємо інакше (див. §3.3).

- **Backend → Python 3.12 + FastAPI** (ASGI) замість самописного Node+JWT. Причини:  
  1) простіший доступ до системних метрик через **psutil**;  
  2) зріла екосистема для SSE/WebSocket;  
  3) швидке прототипування з типізацією pydantic v2;  
  4) FFmpeg керуємо через `asyncio.create_subprocess_exec`.

  > **Альтернатива**: Node.js + Express — можливо, але потребує власної реалізації метрик/процес‑менеджменту; залишаємо як запасний варіант.

- **Auth/DB/Storage → Supabase Free** (Postgres + Auth + Storage, з **Row‑Level Security**). Це **спрощує** автентифікацію (email‑link/Google), дає готовий RLS і не вимагає самостійно зберігати паролі. У будь‑який момент можна мігрувати на власний Postgres/Keycloak.  
  > **Альтернатива**: локальна БД (SQLite/Postgres) + самописний JWT. Можливо, але підвищує ризики безпеки та час на реалізацію.

- **Frontend → Next.js (TypeScript) + Tailwind + TanStack Query**: мінімальний чистий UI (Dashboard / Assets / Playlists / Destinations / Streams).

- **Реверс‑проксі + TLS → Caddy** (авто Let’s Encrypt).

- **Самохостингові медіасервери** (MediaMTX / nginx‑rtmp / SRS / Node‑Media‑Server) **не входять у MVP**. Вони корисні як «хаб» для прийому OBS/RTMP або локального прев’ю, але зростять складність. Додамо пізніше за потреби.

---

## 1) Зовнішні вимоги (House Profile) і обмеження

Щоб працювати **без перекодування**, **вхідні файли** мусять відповідати профілю, який сумісний із **YouTube RTMPS ingest**:

- **Відео**: H.264/AVC, профіль **High/Main**, `yuv420p`, FPS ≤ 60, **CBR**.  
- **Аудіо**: AAC (стерео, 44.1/48 kHz).  
- **GOP (keyframe)**: ~**2 с** (макс. **4 с**).  
- **Бітрейти**: за таблицею YouTube (орієнтир 1080p: 8–12 Мбіт/с, 720p: ~6 Мбіт/с).  
- **Протокол**: **RTMPS** (TLS) на **порті 443**, адреса виду `rtmps://a.rtmp.youtube.com/live2/<KEY>`.

> Невідповідні файли **заборонено** запускати у режимі `-c copy`. Користувач бачить «непридатно для stream copy» та (опційно) кнопку **одноразової підготовки** (офлайн‑нормалізація).

---

## 2) Архітектура MVP

```
[Next.js Web UI]  →  [FastAPI]  →  [Supabase: Auth + Postgres + Storage]
                                ↘  [FFmpeg Manager → workers (tee/fifo)]
                                         ↘ RTMPS → YouTube (N каналів)
```

**Принципи:** один процес FFmpeg на стрім/плейлист; **один енкод** → **багато виходів** через `tee`; читання файлів у реальному часі `-re`; відмова/відновлення через `fifo` (спроби відновлення підключення).

---

## 3) Внутрішня логіка стріму

### 3.1 Перевірка файлу (після завантаження)
- `ffprobe -v quiet -print_format json -show_streams -show_format` → знімаємо codec/profile/level/resolution/fps, аудіо‑параметри та індикатори GOP/CBR.  
- Якщо **всі** параметри відповідають «House Profile» — **OK** для `-c copy`. Інакше — **Reject** (для MVP) або **Prepare** (див. нижче).

### 3.2 Плейлисти без рекоду
- Використовуємо **concat demuxer** (`-f concat -safe 0 -i list.txt`) **лише** якщо *всі файли ідентичні за параметрами*.  
- **Заборонено** робити «рекурсивні» плейлисти (self‑reference `list.txt`) для нескінченного повтору — це виснажує дескриптори.  
- **Нескінченність** реалізуємо двома безпечними способами:
  1) **Офлайн конкатенація в один `*.ts`** (без рекоду) і далі `-stream_loop -1` на цьому файлі.  
  2) **Керований перезапуск**: менеджер відстежує завершення плейлиста і **миттєво перезапускає** процес з того ж списку (видима пауза в межах RTMP‑буфера зазвичай не сприймається як розрив).

### 3.3 Мультивихід (симулькаст)
- Один процес FFmpeg з **`tee` muxer** роздає **однаковий** потік у кілька RTMPS‑адрес.  
- Для кожного виходу застосовуємо `fifo=format=flv:attempt_recovery=1` щоб переживати короткі мережеві збої, не зупиняючи увесь процес.

### 3.4 Базова команда FFmpeg (плейлист → кілька каналів)
```bash
ffmpeg -re -f concat -safe 0 -i /streams/<stream-id>/playlist.txt \
  -c copy \
  -f tee \
  "[f=fifo:fifo_format=flv:attempt_recovery=1]rtmps://a.rtmp.youtube.com/live2/KEY1|\
   [f=fifo:fifo_format=flv:attempt_recovery=1]rtmps://a.rtmp.youtube.com/live2/KEY2"
```

### 3.5 «Prepare» (опціонально, офлайн, разово)
- Кнопка «Підготувати файл» запускає **разову нормалізацію** у House Profile (H.264 High, 30/60 fps, GOP=2s, AAC, CBR). Вона **може** навантажувати CPU, але лише один раз — не 24/7.
- Також доступний **варіант без рекоду**: зведення сумісних MP4 у **один `combined.ts`** через `-c copy -bsf:v h264_mp4toannexb -f mpegts`, після чого запуск з `-stream_loop -1`.

---

## 4) Дані та моделі

- **users** (керує Supabase Auth)  
- **projects** (id, owner_id, name)  
- **assets** (id, project_id, path, `meta` JSON, `compatible_for_copy` bool)  
- **playlists** (id, project_id, name, loop bool)  
- **playlist_items** (playlist_id, asset_id, order)  
- **destinations** (id, project_id, name, rtmps_url, stream_key, enabled)  
- **streams** (id, project_id, playlist_id, status, pid, log_path, started_at)  
- **events** (stream_id, ts, level, message)

**RLS**: користувач бачить / змінює **лише свої** записи.

---

## 5) API (мінімум)

- `POST /assets` — реєстрація файлу, запуск `ffprobe` → `meta`, `compatible_for_copy`  
- `GET /assets` — список файлів поточного користувача  
- `POST /playlists` / `PUT /playlists/:id` — CRUD, перевірка однорідності для concat  
- `POST /destinations` — додати RTMPS (URL + KEY)  
- `POST /streams` — створити стрім (playlist_id, destinations[])  
- `POST /streams/:id/start` — згенерувати `playlist.txt`, підняти FFmpeg (tee+fifo), зберегти `pid`  
- `POST /streams/:id/stop` — коректно зупинити (`SIGINT`), очистити `pid`  
- `GET /streams/:id/status` — `running/stopped`, uptime, останні події  
- `GET /streams/:id/logs/stream` — SSE або WebSocket для логів у реальному часі

---

## 6) Frontend (екрани)

1. **Login** (Supabase Auth)  
2. **Dashboard** (як на прикладі): серверне навантаження (CPU/RAM/Disk/NET), «скільки ще потоків при X Мбіт/с», списки активних стрімів (картки Start/Stop/Delete, останній статус push).  
3. **Assets**: завантаження (Uppy+tus), перевірка `ffprobe`, бейдж «OK для copy / Не OK».  
4. **Playlists**: drag&drop, `loop`, попередження при змішаних параметрах.  
5. **Destinations**: список RTMPS‑виходів (primary/backup/інші).  
6. **Streams**: старт/стоп, лог‑в’ювер (tail), live‑статуси через SSE.

---

## 7) Dev/Ops та безпека

- **TLS/HTTPS** через Caddy.  
- Зашифроване зберігання stream‑keys; маскування у UI.  
- **systemd**/**Supervisor**: авто‑рестарт API та воркерів FFmpeg; лог‑ротація.  
- **psutil** для метрик; оцінка headroom (uplink ÷ target_bitrate × коеф.).  
- **Sentry** (опційно) — клієнт і сервер для помилок.  
- Брандмауер: відкриті 80/443; RTMP‑виходи — вихідні з’єднання (порт 443).

---

## 8) Технологічний стек і бібліотеки

- **Backend**: Python 3.12, **FastAPI**, Uvicorn, Pydantic v2, SQLAlchemy, `httpx`, `orjson`, **psutil**, `aiofiles`, SSE/WebSocket (FastAPI).  
- **Frontend**: Next.js (TS), Tailwind CSS, **@tanstack/react-query**, Zustand, react‑hook‑form + zod, **Uppy + @uppy/tus** для великих аплоадів.  
- **Auth/DB/Storage**: **Supabase** (Auth + Postgres + RLS + Storage).  
- **FFmpeg**: не нижче 6.x.  
- **Ops**: Caddy (або Nginx), **systemd**/**Supervisor**, Sentry SDKs.

---

## 9) Вимоги до середовища

- Ubuntu LTS, 2 vCPU / 4–8 GB RAM / SSD.  
- Аплінк: `N каналів × (бітрейт потоку) × 1.15` запас.  
- FFmpeg/ffprobe інстальовані; Docker — опційно.  
- Домен + HTTPS (Let’s Encrypt).

---

## 10) Ризики та як їх зняти

- **Файли різних параметрів** → concat дасть помилки/розсинхрон. Вирішення: сувора валідація та/або офлайн «Prepare».  
- **Саморекурсивні плейлисти** → витік дескрипторів. Вирішення: **не використовувати** цей трюк.  
- **Падіння одного виходу блокує весь процес** → `fifo` з `attempt_recovery=1` + backoff‑перезапуск.  
- **Трафік** → прорахунок headroom + обмеження кількості одночасних потоків у UI.

---

## 11) Структура репозиторію

```
repo/
  backend/
    app/
      main.py
      deps/auth.py
      db.py
      models.py
      schemas.py
      routers/
        assets.py
        playlists.py
        destinations.py
        streams.py
      streams/
        validator.py
        playlist_builder.py
        ffmpeg_runner.py
        manager.py
        log_parser.py
    scripts/
      systemd/stream@.service
      supervisor/streams.conf
    Dockerfile
  frontend/
    src/
      pages/(app)/...
      pages/login.tsx
      pages/streams/index.tsx
      pages/streams/[id].tsx
      components/
        UploadDialog.tsx
        PlaylistEditor.tsx
        DestinationsForm.tsx
        StreamCard.tsx
        LogViewer.tsx
      lib/supabase.ts
      lib/api.ts
    Dockerfile
  docs/
    HOUSE_PROFILE.md
    RUNBOOK.md
```

---

## 12) Команди FFmpeg (довідник)

### 12.1 Нескінченний луп одного файлу
```bash
ffmpeg -re -stream_loop -1 -i input.mp4 -c copy -f flv "rtmps://a.rtmp.youtube.com/live2/<KEY>"
```

### 12.2 Плейлист без рекоду (ідентичні параметри)
Файл `playlist.txt`:
```
ffconcat version 1.0
file '/videos/clip1.mp4'
file '/videos/clip2.mp4'
file '/videos/clip3.mp4'
```
Запуск:
```bash
ffmpeg -re -f concat -safe 0 -i playlist.txt -c copy -f flv "rtmps://a.rtmp.youtube.com/live2/<KEY>"
```

### 12.3 Мультивихід одним процесом
```bash
ffmpeg -re -f concat -safe 0 -i playlist.txt -c copy -f tee \
"[f=fifo:fifo_format=flv:attempt_recovery=1]rtmps://a.rtmp.youtube.com/live2/KEY1|\
 [f=fifo:fifo_format=flv:attempt_recovery=1]rtmps://a.rtmp.youtube.com/live2/KEY2"
```

### 12.4 Офлайн конкат у TS (без рекоду) + нескінченний луп
```bash
# 1) Підготовка сумісного TS
ffmpeg -f concat -safe 0 -i playlist.txt -c copy \
  -bsf:v h264_mp4toannexb -f mpegts combined.ts

# 2) Нескінченний луп на вихід
ffmpeg -re -stream_loop -1 -i combined.ts -c copy -f flv "rtmps://a.rtmp.youtube.com/live2/<KEY>"
```

### 12.5 «Prepare» (одноразова нормалізація у House Profile)
```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -r 30 -g 60 \
  -b:v 4000k -maxrate 4000k -bufsize 8000k \
  -c:a aac -b:a 192k -ar 44100 \
  -movflags +faststart \
  output_prepared.mp4
```

---

## 13) План робіт (фази у стилі чек‑листів)

> Орієнтовні строки MVP: **2–3 тижні** чистого часу однієї людини.

### **Фаза 0: Ініціалізація та стандарти (0.5–1 день)**
- [ ] Monorepo (frontend+backend), `prettier/eslint`, `ruff/mypy`.
- [ ] Dockerfile для FE/BE; docker‑compose локально.
- [ ] Caddy reverse proxy + HTTPS (Let’s Encrypt).  
  **Файли**: `docker-compose.yml`, `Caddyfile`, `frontend/Dockerfile`, `backend/Dockerfile`.

---

### **Фаза 1.1: Ядро даних та стрім‑пайплайн (3–5 днів)**
**1.1.1. Валідатор файлів**
- [ ] `ffprobe` JSON → `streams/validator.py` → `AssetMeta`, прапор `compatible_for_copy`.
- [ ] Збереження метаданих у `assets.meta` (JSONB).  
  **Файли**: `backend/app/streams/validator.py`, `backend/app/schemas.py`, `backend/app/models.py`.

**1.1.2. Плейлист і Tee/Fifo**
- [ ] `playlist_builder.py` (concat‑демультиплексор, перевірка однорідності параметрів).
- [ ] `ffmpeg_runner.py` (конструктор команд `-re -f concat -c copy -f tee` з `fifo`).
- [ ] Лог‑парсер (stderr → події connected/disconnected/bytes).  
  **Файли**: `backend/app/streams/{playlist_builder.py,ffmpeg_runner.py,log_parser.py,manager.py}`.

**1.1.3. Базові ендпоінти**
- [ ] `POST /streams/:id/start` — запуск процесу (`asyncio.create_subprocess_exec`), збереження PID.
- [ ] `POST /streams/:id/stop` — коректний `SIGINT` і очищення PID.
- [ ] `GET /streams/:id/status` — `running/stopped`, uptime, останні N рядків логу.  
  **Файли**: `backend/app/routers/streams.py`.

---

### **Фаза 1.2: Валідація і узгодженість (2–3 дні)**
- [ ] Supabase Auth (email‑link/Google), токен‑перевірка на BE.
- [ ] **RLS політики** для `projects/assets/playlists/destinations/streams`.  
- [ ] Заборонити додавання до плейлиста файлів із різними параметрами (error‑toast у UI).  
  **Файли**: `backend/app/deps/auth.py`, `backend/app/models.py`, `frontend/src/lib/supabase.ts`.

---

### **Фаза 1.3: Завантаження великих файлів (2–3 дні)**
- [ ] Підняти **tusd** (Docker), вебхук «upload finished» → створити `asset` і запустити `ffprobe`.
- [ ] На фронті — **Uppy + @uppy/tus** з прогресом/ретраями.  
  **Файли**: `frontend/src/components/UploadDialog.tsx`, `backend/app/routers/assets.py`, `docs/RUNBOOK.md`.

---

### **Фаза 1.4: UI керування потоками (2–3 дні)**
- [ ] **Dashboard**: Live‑метрики psutil, headroom‑оцінка, список потоків із **Start/Stop**.
- [ ] **Streams detail**: останній лог (tail), SSE для оновлень.  
  **Файли**: `frontend/src/pages/streams/index.tsx`, `frontend/src/pages/streams/[id].tsx`, `frontend/src/components/{StreamCard.tsx,LogViewer.tsx}`.

---

### **Фаза 1.5: Стійкість і обробка помилок (1–2 дні)**
- [ ] `fifo` + `attempt_recovery=1` у виходах `tee` (мережеві «гойдалки»).
- [ ] Авто‑рестарт воркерів при non‑zero exit (backoff).
- [ ] Модалка «детальна помилка», кнопка **«Повторити для провалившихся»** (перезапуск з проблемними виходами).  
  **Файли**: `backend/app/streams/manager.py`, `frontend/src/components/PushTab.tsx`.

---

### **Фаза 1.6: Безпека (1 день)**
- [ ] HTTPS скрізь; маскування ключів; зберігання секретів зашифрованими.
- [ ] Тести RLS/ACL; обмеження кількості активних потоків на користувача.

---

### **Фаза 1.7: Операційка (1 день)**
- [ ] **systemd** юніти для API та стрім‑воркерів (`Restart=on-failure`).
- [ ] Лог‑ротація, прості алерти (email/Telegram — опціонально).

---

## 14) Нефункціональні вимоги

- Низький CPU завдяки `-c copy`; вузьке місце — **uplink**.  
- Безпека доступу (RLS) та шифрування ключів.  
- Відмова одного виходу не валить решту (tee+fifo).  
- Простий деплой на один сервер, подальше масштабування горизонтально (воркери FFmpeg на інші вузли).

---

## 15) Посилання (корисні для розробки)

- YouTube Live: налаштування енкодера, бітрейти, keyframe, RTMPS — https://support.google.com/youtube/answer/2853702  
- YouTube RTMPS (SSL/TLS, порт 443) — https://developers.google.com/youtube/v3/live/guides/rtmps-ingestion  
- Порівняння RTMP vs RTMPS — https://developers.google.com/youtube/v3/live/guides/ingestion-protocol-comparison  
- FFmpeg `-re` (стрім у реальному часі) — https://trac.ffmpeg.org/wiki/StreamingGuide  
- FFmpeg **tee** (мультивихід) — https://trac.ffmpeg.org/wiki/Creating%20multiple%20outputs  
- FFmpeg **concat demuxer** (однакові параметри!) — https://trac.ffmpeg.org/wiki/Concatenate  
- Попередження щодо **рекурсивних плейлистів** (витік дескрипторів) — https://trac.ffmpeg.org/wiki/Concatenate  
- FFmpeg **fifo** (спроба відновлення при збоях) — https://ffmpeg.org/ffmpeg-formats.html  
- Bitstream‑фільтри (`h264_mp4toannexb`, `aac_adtstoasc`) — https://ffmpeg.org/ffmpeg-bitstream-filters.html  
- Supabase: **Row‑Level Security** — https://supabase.com/docs/guides/database/postgres/row-level-security  
- tusd (resumable uploads) — https://tus.github.io/tusd/ ; Uppy/tus — https://uppy.io/docs/tus/  
- WebSockets/SSE у FastAPI — https://fastapi.tiangolo.com/advanced/websockets/

---

## 16) Acceptance‑критерії MVP (checklist)

- [ ] Користувач логіниться; бачить **лише свої** ресурси.  
- [ ] Завантаження файлів (відновлюване), `ffprobe`‑валідація, бейдж **OK/Not OK**.  
- [ ] Плейлист з **однорідних** файлів; **Start/Stop** стріму без рекоду.  
- [ ] **Мультивихід** на кілька YouTube‑каналів з **одного** процесу.  
- [ ] UI показує **статус/логи** у реальному часі; **авто‑рестарт** після збоїв.  
- [ ] Серверні метрики і оцінка headroom (скільки потоків ще можна).  
- [ ] HTTPS, шифрування ключів, RLS‑політики чинні.

---

## 17) Roadmap після MVP

- **Офлайн нормалізація** у «house profile» одним кліком (черга задач).  
- **Медіахаб** (MediaMTX/nginx‑rtmp/SRS) для прийому OBS/RTMP, локального прев’ю, рестриму на інші платформи.  
- **Prometheus/Grafana**, алерти, Telegram‑бот.  
- **YouTube API** (опціонально): створення Live‑подій, статуси якості інгесту, автоперемикання «Go Live».

---

### Додаток A — Чому ми **не** робимо «рекурсивний playlist.txt»
FFmpeg‑wiki прямо попереджає: **рекурсивні посилання** у concat‑плейлистах призводять до того, що ffmpeg **не закриває** файли й «з’їдає» дескриптори — у підсумку процес падає. Тому ми або робимо **офлайн `combined.ts`** і лупимо його (`-stream_loop -1`), або **перезапускаємо** плейлист менеджером без самопосилань.

### Додаток B — Оцінка каналів/трафіку
- Потік 1080p @ 8 Мбіт/с → **~8 Мбіт/с** на **кожну** RTMPS‑адресу.  
- Для N каналів: `N × 8 Мбіт/с × 1.15` (запас).  
- Добовий обсяг ≈ `бітрейт (Мбіт/с) × 10.5 ГБ` (орієнтовно).

---

**Кінець документа.**
