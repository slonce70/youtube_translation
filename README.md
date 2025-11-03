# 24/7 YouTube Multi-Channel Streaming Service

Simple self-hosted service for 24/7 streaming to multiple YouTube channels without transcoding.

## Features

- ✅ Stream to multiple YouTube channels simultaneously
- ✅ No transcoding (low CPU usage with `-c copy`)
- ✅ Resumable file uploads
- ✅ Playlist management
- ✅ Real-time monitoring
- ✅ User authentication with Supabase
- ✅ Automatic HTTPS with Caddy

## Tech Stack

**Backend:**
- FastAPI (Python 3.12+)
- FFmpeg 6.x+
- PostgreSQL (Supabase)

**Frontend:**
- Next.js 15
- React 19
- TypeScript
- Tailwind CSS

**Infrastructure:**
- Docker + Docker Compose
- Caddy 2.x (Reverse Proxy)
- tusd (Resumable uploads)

## Quick Start

### Prerequisites

- Docker & Docker Compose
- FFmpeg installed
- Supabase account (free tier)

### Setup

1. Clone the repository:
```bash
git clone <repo-url>
cd youtube_translation
```

2. Copy environment files:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

3. Configure Supabase credentials in `.env` files

4. Start the services:
```bash
docker-compose up -d
```

5. Access the application:
- Frontend: https://localhost:3000
- Backend API: https://localhost:8000

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed setup instructions.

## License

MIT
