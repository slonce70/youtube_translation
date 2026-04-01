# Техдизайн: YouTube OAuth/API, VOD segmentation та live controls

Дата: 2026-03-21
Контекст: issue `YOU-6`

## Навіщо це потрібно

Поточний продукт уже вміє:

- конфігурувати стріми та керувати runtime через `backend/app/api/routes/streams.py`
- запускати/зупиняти FFmpeg, scheduler і managed runtime через `backend/app/services/streams/control.py`
- оновлювати live-чергу без рестарту через `backend/app/services/streams/service.py` та `backend/app/streaming/hot_swap.py`
- показувати live-стан і простий live editor у `frontend/src/lib/api.ts`, `frontend/src/app/dashboard/streaming/hooks/useLiveEditor.ts`, `frontend/src/app/dashboard/streaming/components/LiveEditorModal.tsx`

Але зараз система працює лише на рівні RTMPS destination + stream key:

- `destinations` зберігає тільки `rtmps_url` і `stream_key_encrypted`
- у `streams` немає звʼязку з YouTube broadcast/stream/video ресурсами
- live controls обмежені `enqueue`, `replace_queue` і `restart`
- немає окремого шару для OAuth, channel discovery, YouTube lifecycle та VOD-сегментів

## Цілі

- Додати безпечний OAuth connect для YouTube-каналу з довгоживучим refresh token.
- Керувати життєвим циклом YouTube live broadcast через API, а не лише через ручний stream key.
- Зафіксувати сегменти довгих ефірів як продуктову сутність для повторного використання, кліпів і VOD workflow.
- Розширити live controls до операторського рівня: skip, jump, emergency clip, reload playlist.
- Вирізати мінімальний production-safe slice, який можна релізити маленькими ітераціями.

## Non-goals першої хвилі

- Повний multi-channel CMS/onBehalfOfContentOwner flow для контент-партнерів.
- Автоматичний монтаж кліпів у готовий MP4-файл на першій ітерації.
- Повний чат/модерація live chat.
- Заміну наявного RTMPS сценарію. Перший реліз має працювати поруч із ним.

## Зовнішні обмеження YouTube API

- Для web-server сценарію треба серверний OAuth 2.0 flow з `access_type=offline`, `state` та зберіганням refresh token. Це прямо випливає з офіційного server-side OAuth guide.
- YouTube Live Streaming API lifecycle складається з `liveBroadcasts.insert`, `liveStreams.insert`, `liveBroadcasts.bind`, а далі `liveBroadcasts.transition` до `testing`, `live` і `complete`.
- Офіційна документація рекомендує перевіряти `status.streamStatus == active` перед переходом у `testing/live`.
- YouTube Data API має добову квоту за замовчуванням 10_000 units, причому live-методи також її споживають.
- Я не знайшов у поточному офіційному reference окремого endpoint для створення user-facing clips. Тому `emergency clip` у першій хвилі треба трактувати як локальний сегмент/маркер з подальшим VOD workflow, а не як прямий YouTube Clip API.

## Поточні точки інтеграції в коді

### Backend

- `backend/app/api/routes/streams.py`
  Поточні endpoints уже покривають `start`, `stop`, `status`, `logs`, `live-config`, `queue`.
- `backend/app/services/streams/service.py`
  Тут уже є domain-layer для live update та enqueue, тобто live controls логічно продовжувати саме тут.
- `backend/app/services/streams/control.py`
  Тут live-оркестрація runtime, scheduler stop/start та інтеграція з `ffmpeg_manager`.
- `backend/app/services/streams/scheduler.py`
  Це правильне місце для автоматичних transition в YouTube lifecycle під час scheduled start/stop.
- `backend/app/models/database.py`
  Потрібно розширювати схему, не перевантажуючи `streams` JSON-полями.

### Frontend

- `frontend/src/lib/api.ts`
  Єдиний клієнтський API facade; тут треба додати YouTube OAuth, channel sync і live controls endpoints.
- `frontend/src/app/dashboard/streaming/hooks/useLiveEditor.ts`
  Вже є операторська логіка для queueing/apply; вона стане основою для `skip`, `jump`, `reload`.
- `frontend/src/app/dashboard/streaming/components/StreamsList.tsx`
  Природне місце для відображення YouTube lifecycle і state badges.
- `frontend/src/app/dashboard/streaming/components/LiveEditorModal.tsx`
  Природне місце для нових control actions без створення окремого розрізненого UI.

## Цільова архітектура

### 1. YouTube connection layer

Нові сутності:

- `youtube_connections`
  Один запис на Google account connect.
  Поля: `id`, `user_id`, `google_account_email`, `scopes`, `refresh_token_encrypted`, `refresh_token_expires_at`, `token_status`, `last_synced_at`, `created_at`, `updated_at`.
- `youtube_channels`
  Знімок каналів, доступних через підключення.
  Поля: `id`, `connection_id`, `youtube_channel_id`, `title`, `thumbnail_url`, `is_default`, `can_stream_live`, `raw_status_json`, `last_synced_at`.

Принципи:

- access token не зберігаємо як довгоживучий state, тільки refresh token і derived metadata
- refresh token шифруємо так само, як stream key, але через окремий generic helper для secret encryption
- кожен API виклик до YouTube працює через окремий token refresh wrapper і typed client

### 2. YouTube live resource layer

Нові сутності:

- `youtube_live_bindings`
  Звʼязок між нашим `streams.id` і YouTube ресурсами.
  Поля: `id`, `stream_id`, `youtube_channel_id`, `youtube_broadcast_id`, `youtube_stream_id`, `youtube_video_id`, `youtube_ingestion_address`, `youtube_stream_name`, `youtube_stream_status`, `youtube_lifecycle_status`, `auto_start`, `auto_stop`, `bound_at`, `last_synced_at`, `last_error`.
- `youtube_lifecycle_events`
  Аудит і retry-safe журнал transition/bind/sync кроків.

Принципи:

- `destinations` лишається source of truth для RTMPS fallback
- YouTube-managed binding зберігається окремо, щоб не ламати існуючі destination flows
- stream може мати або manual RTMPS destination, або YouTube-managed binding, або обидва режими під час міграції

### 3. VOD segmentation layer

Нові сутності:

- `stream_segments`
  Поля: `id`, `stream_id`, `segment_index`, `kind`, `started_at`, `ended_at`, `started_offset_seconds`, `ended_offset_seconds`, `source_asset_id`, `source_playlist_item_ref`, `source_collection_item_ref`, `trigger`, `title`, `notes`, `status`, `artifact_path`, `youtube_video_id`.
- `stream_control_events`
  Операторські команди з timestamp і actor context: `skip`, `jump`, `reload`, `segment_start`, `segment_end`, `emergency_clip`.

Принципи:

- на першій хвилі сегмент є metadata+timeline сутністю
- окремий media artifact вирізається асинхронно пізніше через FFmpeg job
- `emergency clip` спочатку створює segment marker високого пріоритету, а не намагається одразу викликати неіснуючий clip endpoint у YouTube

### 4. Live controls layer

Нові команди:

- `skip`
  Негайно зрушує playhead до наступного slot у `hot_swap`
- `jump`
  Примусово ставить конкретний asset наступним для відтворення
- `reload playlist`
  Повторно читає playlist/collection із БД і робить `replace_queue` без повного restart, якщо runtime дозволяє
- `emergency clip`
  Створює segment marker, опційно ставить терміновий asset у початок черги

Реалізаційний принцип:

- операторські команди мають бути idempotent через `control_event_id`
- runtime side-effect і DB event мають фіксуватися в одній service-операції
- для supervisor/systemd режимів, де hot swap обмежений, команда або деградує до safe restart, або повертає control capability matrix у UI

## Пропоновані API зміни

### Новий router `backend/app/api/routes/youtube.py`

- `POST /api/youtube/oauth/start`
- `GET /api/youtube/oauth/callback`
- `GET /api/youtube/channels`
- `POST /api/youtube/channels/{channel_id}/sync`
- `POST /api/streams/{stream_id}/youtube/provision`
- `POST /api/streams/{stream_id}/youtube/transition`
- `POST /api/streams/{stream_id}/youtube/sync`
- `DELETE /api/streams/{stream_id}/youtube/binding`

### Розширення `backend/app/api/routes/streams.py`

- `POST /api/streams/{stream_id}/controls/skip`
- `POST /api/streams/{stream_id}/controls/jump`
- `POST /api/streams/{stream_id}/controls/reload`
- `POST /api/streams/{stream_id}/controls/emergency-clip`
- `GET /api/streams/{stream_id}/segments`

### Frontend facade

У `frontend/src/lib/api.ts` додати:

- `api.youtube.startOauth()`
- `api.youtube.listChannels()`
- `api.youtube.provisionStream(streamId, payload)`
- `api.streams.skip(streamId)`
- `api.streams.jump(streamId, payload)`
- `api.streams.reload(streamId)`
- `api.streams.emergencyClip(streamId, payload)`
- `api.streams.listSegments(streamId)`

## Runtime design

### Start flow

1. Користувач підключає YouTube channel через OAuth.
2. Backend зберігає refresh token, синкає `channels.list(mine=true)` і створює `youtube_channels`.
3. Для стріму викликається `provision`:
   - `liveBroadcasts.insert`
   - `liveStreams.insert`
   - `liveBroadcasts.bind`
   - зберігаються YouTube ids та ingestion info
4. Наш FFmpeg runtime або:
   - стрімить у YouTube ingestion address/stream name з binding, або
   - продовжує працювати через існуючий RTMPS destination, якщо binding не увімкнено
5. Scheduler або ручний start після перевірки stream status робить transition `testing/live`

### Stop flow

1. `stop_stream` завершує локальний runtime
2. якщо є YouTube binding і broadcast у `live/testing`:
   - викликаємо `transition -> complete`
3. якщо `recordFromStart=true`, очікуємо VOD availability і синкаємо `youtube_video_id`

### Segment flow

1. Під час runtime ми знаємо playhead, asset і operator actions.
2. При `jump/skip/emergency_clip` пишемо `stream_control_events`.
3. Segment builder перетворює timeline подій у `stream_segments`.
4. Асинхронний worker зможе пізніше вирізати локальний артефакт або підготувати metadata для YouTube upload/publishing.

## Мінімальний slice для першої реалізації

### Slice 1. OAuth + channel sync

- backend: `youtube_connections`, `youtube_channels`, OAuth callback, refresh wrapper
- frontend: connect/disconnect channel UI
- ready condition: оператор бачить список своїх каналів і стан live-enabled

### Slice 2. YouTube-managed broadcast для одного стріму

- backend: `youtube_live_bindings`, provision/bind/transition/sync
- scheduler: під час scheduled start/stop викликає transition hooks
- ready condition: один stream можна запустити/зупинити повністю через наш UI без ручного заходу в YouTube Studio

### Slice 3. Live controls v1

- `skip`, `reload playlist`, `jump`
- capability matrix для manager/supervisor/systemd vs in-process runtime
- ready condition: оператор може керувати чергою в running stream без повного restart там, де runtime дозволяє

### Slice 4. Segment markers v1

- `stream_segments` + `stream_control_events`
- UI таймлайн сегментів
- ready condition: після довгого ефіру видно операторські сегменти й їхні межі, навіть без готового MP4 export

## Ризики і як їх прибирати

- OAuth/token invalidation
  Потрібен token status machine (`active`, `revoked`, `reauth_required`) і явний UX для reconnect.
- YouTube quota exhaustion
  Потрібен локальний throttling, backoff і окремі sync job-и замість polling на кожен page refresh.
- Stream transition race
  Потрібен lifecycle lock на `stream_id`, щоб scheduler/manual actions не штовхали `transition` паралельно.
- Runtime capability mismatch
  Не всі live controls можна чесно дати в supervisor/systemd режимах. Це має бути явна capability-відповідь із backend, а не hidden failure.
- Emergency clip ambiguity
  До появи artifact worker не обіцяємо користувачу "готовий кліп", а показуємо "segment saved".

## Що змінювати в repo першими PR

1. Схема БД + моделі для `youtube_connections`, `youtube_channels`, `youtube_live_bindings`.
2. `app/services/youtube/` з typed client, token refresh wrapper і lifecycle service.
3. Новий router `backend/app/api/routes/youtube.py`.
4. Розширення `StreamControlService` і `StreamService` для control commands.
5. Додавання capability/YouTube state у `StreamResponse`.
6. Окремий frontend flow для connect channel і control buttons у streaming dashboard.

## Рішення по scope

Рекомендований перший production slice:

- OAuth connect + channel sync
- provision/bind/transition одного broadcast на один stream
- `skip` і `reload playlist`
- segment markers без негайного clip export

## Офіційні джерела

Перевірено проти офіційної документації станом на 2026-03-22:

- Google OAuth 2.0 for Web Server Applications:
  https://developers.google.com/identity/protocols/oauth2/web-server
- YouTube Data API reference:
  https://developers.google.com/youtube/v3/docs
- YouTube Live Streaming API reference:
  https://developers.google.com/youtube/v3/live/docs
- YouTube Data API quota costs:
  https://developers.google.com/youtube/v3/determine_quota_cost

Примітка щодо `emergency clip`: висновок про відсутність прямого публічного Clip API для цього flow зроблено з поточного офіційного API reference, де окремий clip resource/endpoint не документований.

Це найменший зріз, який:

- помітно підвищує цінність продукту
- не ламає чинний RTMPS pipeline
- вкладається в безпечні ітерації
- створює правильний фундамент для VOD/clips і ширших YouTube controls

## Зовнішні джерела

- Server-side OAuth for YouTube Data API: https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- YouTube Live Streaming API overview: https://developers.google.com/youtube/v3/live/getting-started
- Life of a Broadcast: https://developers.google.com/youtube/v3/live/life-of-a-broadcast
- liveBroadcasts.bind reference: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/bind
- Channel ID via `channels.list(mine=true)`: https://developers.google.com/youtube/v3/guides/working_with_channel_ids
- Quota calculator: https://developers.google.com/youtube/v3/determine_quota_cost
