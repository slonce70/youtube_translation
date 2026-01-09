# Architecture Documentation

## System Overview

The YouTube Multi-Channel Streaming Service is a self-hosted web application that enables 24/7 streaming to multiple YouTube channels simultaneously without transcoding.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                   CLIENT BROWSER                     │
│              (Next.js 15 + React 19)                 │
└────────────────┬────────────────────────────────────┘
                 │ HTTPS
                 ▼
┌─────────────────────────────────────────────────────┐
│              CADDY (Reverse Proxy)                   │
│         • Auto HTTPS (Let's Encrypt)                 │
│         • SSL Termination                            │
└────────┬────────────────────────────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌─────────┐ ┌──────────────────────────────────────┐
│ Next.js │ │        FastAPI Backend               │
│Frontend │ │  • REST API                          │
│   :3000 │ │  • WebSocket/SSE для live статусів   │
└─────────┘ │  • Scheduler + FFmpeg control        │
            │  • File Validator (ffprobe)          │
            └───────┬──────────────┬──────────────┘
                    │              │
                    ▼              ▼
               ┌────────┐     ┌────────┐
               │Supabase│     │  tusd  │
               │ Auth + │     │Resumable│
               │  DB +  │     │ Upload  │
               │Storage │     └────────┘
               └────────┘
                    │ supervisorctl (unix socket)
                    ▼
            ┌──────────────────────────┐
            │   Runner (supervisord)   │
            │  • python -m app.cli...  │
            └──────────┬───────────────┘
                       ▼
               ┌─────────────┐
               │FFmpeg Workers│
               │(tee muxer)  │
               └──────┬──────┘
                      ▼
       ┌──────────────────────────┐
       │  RTMPS → YouTube Channels│
       │  • Channel 1             │
       │  • Channel 2             │
       │  • Channel N             │
       └──────────────────────────┘
```

## Core Components

### 1. Frontend (Next.js 15)

**Technology Stack:**
- Next.js 15 with App Router
- React 19 Server Components
- TypeScript
- Tailwind CSS
- TanStack Query for state management

**Key Features:**
- Server-side rendering for better SEO
- Real-time updates via Server-Sent Events (SSE)
- Responsive dashboard with system metrics
- Drag-and-drop playlist editor

**Pages:**
- `/` - Dashboard with active streams and metrics
- `/login` - Authentication
- `/assets` - Video file management
- `/playlists` - Playlist creation and editing
- `/destinations` - YouTube channel configuration
- `/streams` - Stream control and monitoring

### 2. Backend (FastAPI)

**Technology Stack:**
- FastAPI (Python 3.12+)
- Pydantic for data validation
- SQLAlchemy for database ORM
- asyncio for process management
- psutil for system monitoring

**Core Modules:**

#### API Routes (`app/api/routes/`)
- С thin-ендпоінти, що лише приймають HTTP-запит, роблять базову валідацію та делегують роботу у відповідний сервіс. Це спрощує тестування й дає можливість повторно використовувати логіку в CLI/скриптах.

#### Service Layer (`app/services/`)
- `admin/` — `AdminService`, audit логіка, робота з алертами, моніторинг стрімів.
- `assets/` — `AssetService`, `AssetUploadService`, токени завантажень та інтеграція з валідатором, quota-хелпери.
- `destinations/` — `DestinationService`. Шифрування ключів, quota-перевірки, маскування.
- `media_folders/` та `media_collections/` — інкапсульований CRUD для бібліотеки, включно з bulk-операціями та валідацією активів.
- `playlists/` — `PlaylistService`, що поєднує квоти, валідацію активів і `PlaylistBuilder`.
- `streams/` — `StreamService` + `StreamControlService`, які розділяють створення конфігурацій та керування FFmpeg/quotas.
- `quota/` — `QuotaService` для tusd-хуків і клієнтських запитів.
- `api/deps.py` — `require_user` гарантує наявність `user_profiles` і підхоплює timezone з `X-User-Timezone` (IANA).

#### Streaming Engine (`app/streaming/`)
- `validator.py` - FFprobe-based video validation
- `ffmpeg_manager.py` - Process lifecycle management
- `playlist_builder.py` - Concat demuxer file generation

**Key Features:**
- Asynchronous FFmpeg process management (через `StreamControlService` + `ffmpeg_manager`)
- Реальний час логів та SSE подачі
- Моніторинг ресурсів / reconciliation (`app/core/stream_reconciler.py`)
- Graceful shutdown + auto-restart (supervisor/systemd режими)

### 3. Runner (Supervisor)

In Docker Compose the FFmpeg processes are hosted in a dedicated **runner** container.
The backend controls them via `supervisorctl` over a shared UNIX socket:
`/app/supervisord/supervisor.sock`. The socket, programs, and logs are kept in
the shared `/app/supervisord` volume.

### 4. FFmpeg Streaming Engine

**Core Strategy:**
```bash
ffmpeg -re -f concat -safe 0 -i playlist.txt \
  -c copy \
  -f tee \
  "[f=fifo:fifo_format=flv:attempt_recovery=1]rtmps://channel1|\
   [f=fifo:fifo_format=flv:attempt_recovery=1]rtmps://channel2"
```

**Key Components:**
- `-re` - Read at native frame rate (real-time)
- `-c copy` - Stream copy (NO transcoding)
- `tee` muxer - Multiple outputs from single input
- `fifo` muxer - Automatic recovery on network failures

**Advantages:**
- Low CPU usage (no encoding)
- Single process per playlist
- Automatic reconnection on network issues
- Scalable to multiple channels

### 5. Database (Supabase PostgreSQL)

**Schema:**

```sql
users (managed by Supabase Auth)
  ├─ projects (user workspaces)
      ├─ assets (video files)
      ├─ playlists
      │   └─ playlist_items
      ├─ destinations (YouTube channels)
      └─ streams
          └─ stream_destinations
```

**Security:**
- Row Level Security (RLS) policies
- User isolation
- Encrypted stream keys
- Secure token-based authentication

### 6. File Upload (tusd)

**Technology:**
- tus resumable upload protocol
- Docker containerized
- Webhook on upload completion

**Flow:**
1. Client uploads file via Uppy+tus
2. tusd saves to disk
3. Webhook triggers backend validation
4. FFprobe analyzes compatibility
5. Metadata stored in database

### 7. Observability & Monitoring

- **Structured logging** — все сервисы используют `app.core.logging_config` (JSON + masking). Дополнительный middleware `APIMetricsMiddleware` снимает длительность/статус каждого HTTP-запроса и пишет их в кореллируемые логи.
- **Metrics Registry** — `app.core.metrics` агрегирует счётчики/гистограммы (streams, API, quotas, uploads). Экспорт доступен в двух форматах:
  - `/api/metrics` — агрегированная статистика по CPU/RAM/disk + активным стримам и оценка пропускной способности.
  - `/api/metrics/prometheus` — текстовый экспорт в формате Prometheus (`text/plain; version=0.0.4`).
- **FFmpeg telemetry** — `FFmpegStreamManager` вызывает `track_stream_start`, `track_stream_stop` и `track_stream_error`, поэтому Active Streams gauge и гистограмма длительности отражают реальные процессы (включая auto-restart сценарии).
- **Frontend hooks** — Dashboard и Streaming builder читают `/api/metrics` и отображают квоты/алерты; Jest тесты (`asset-display-info`, `builder-helpers`) проверяют логику отображения предупреждений и редакторов.

## Data Flow

### Stream Start Flow

```
1. User clicks "Start Stream" on frontend
   ↓
2. Frontend → POST /api/streams/{id}/start
   ↓
3. Backend validates playlist and destinations
   ↓
4. PlaylistBuilder prepares video/audio concat playlists (loop/shuffle aware, placeholders when required)
   ↓
5. FFmpegManager builds command per mix mode (video-only, audio-only, mixed) with copy-first fallback to transcode
   ↓
6. Spawns FFmpeg process (asyncio.subprocess)
   ↓
7. Process monitored in background task
   ↓
8. Real-time logs streamed via SSE to frontend
   ↓
9. Stream status updated in database
```

### Video Upload Flow

```
1. User selects video file
   ↓
2. Uppy chunks and uploads to tusd
   ↓
3. tusd saves chunks, reassembles file
   ↓
4. tusd webhook → POST /api/assets/upload-complete
   ↓
5. Backend runs ffprobe validation
   ↓
6. Metadata extracted and stored
   ↓
7. Compatibility flag set (OK/Not OK for copy)
   ↓
8. Frontend updates asset list
```

## Scaling Strategy

### Current MVP (Single Server)

- **Capacity:** ~5-10 simultaneous streams (depends on bandwidth)
- **Bottleneck:** Network bandwidth (not CPU)
- **Estimation:** `available_bandwidth / (stream_bitrate × channels)`

### Future Horizontal Scaling

1. **Worker Nodes:**
   - Separate FFmpeg workers on different servers
   - Queue-based distribution
   - Central API orchestrator

2. **Load Balancing:**
   - Caddy with multiple backends
   - Health checks and failover
   - Geographic distribution

3. **Storage:**
   - S3-compatible object storage
   - CDN for static assets
   - Distributed caching

## Security Considerations

### Authentication
- Supabase Auth with email/social logins
- JWT tokens with expiration
- Session management

### Authorization
- Row Level Security (RLS) in database
- User can only access own resources
- API middleware validates ownership

### Data Protection
- Stream keys encrypted at rest
- HTTPS everywhere (Caddy auto-cert)
- Secrets in environment variables
- No stream keys in logs

### Network Security
- RTMPS (TLS) for YouTube connections
- Rate limiting on API endpoints
- CORS configuration
- Input validation and sanitization

## Monitoring and Observability

### Metrics
- CPU, RAM, Disk, Network usage (psutil)
- Active streams count
- FFmpeg process status
- Upload/download bandwidth

### Logging
- Structured JSON logs
- FFmpeg stderr captured
- Log rotation
- Optional Sentry integration

### Health Checks
- `/health` endpoint for Caddy
- Process liveness checks
- Database connectivity
- FFmpeg availability

## Performance Optimizations

### Backend
- Asynchronous I/O throughout
- Connection pooling
- Efficient database queries
- ORJson for fast JSON serialization

### Frontend
- Server-side rendering
- Code splitting
- Image optimization
- React Server Components

### Streaming
- Stream copy (no transcoding)
- FIFO muxer with recovery
- Efficient playlist file handling
- Process reuse where possible

## Deployment

### Development
```bash
docker-compose up -d
```

### Production
1. Configure domain in Caddyfile
2. Set production environment variables
3. Deploy with Docker Compose
4. Caddy handles HTTPS automatically

### Systemd (Alternative)
```ini
[Unit]
Description=YouTube Streaming Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/youtube-streaming/backend
ExecStart=/opt/youtube-streaming/backend/venv/bin/uvicorn app.main:app
Restart=always

[Install]
WantedBy=multi-user.target
```

## Future Enhancements

1. **Scheduled Streaming** - Cron-like scheduling
2. **YouTube API Integration** - Auto Go Live
3. **Analytics Dashboard** - Viewer stats, bitrate graphs
4. **Multi-user Organization** - Team workspaces
5. **Prepare Function** - Auto-normalize videos
6. **Telegram Bot** - Remote control
7. **Advanced Monitoring** - Prometheus/Grafana

## References

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [FFmpeg Streaming Guide](https://trac.ffmpeg.org/wiki/StreamingGuide)
- [YouTube RTMPS Ingestion](https://developers.google.com/youtube/v3/live/guides/rtmps-ingestion)
- [tus Resumable Upload Protocol](https://tus.io/)
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
