# Development Guide

## Prerequisites

- Python 3.12+
- Node.js 20+
- FFmpeg 6.x+
- Docker & Docker Compose
- Supabase account

## Local Development Setup

### 1. Clone and Setup

```bash
git clone <repo-url>
cd youtube_translation
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env
# Edit .env with your Supabase credentials

# Create directories
mkdir -p uploads streams logs

# Run development server
python -m app.main
```

Backend will be available at: http://localhost:8000

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install
# or
pnpm install

# Copy environment file
cp .env.example .env.local
# Edit .env.local with backend URL and Supabase credentials

# Run development server
npm run dev
```

Frontend will be available at: http://localhost:3000

### 4. Database Setup (Supabase)

1. Create a new project on [Supabase](https://supabase.com)
2. Run the SQL migrations from `backend/migrations/`
3. Enable Row Level Security (RLS) policies
4. Copy your project credentials to `.env` files

### 5. Test File Upload

You need video files in the correct format for testing:

**Required format:**
- Video: H.264, High/Main profile, yuv420p, CBR
- Audio: AAC, 44.1/48 kHz, stereo
- GOP: 2-4 seconds

**Test with sample:**
```bash
# Generate test video (if you don't have one)
ffmpeg -f lavfi -i testsrc=duration=60:size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=1000:duration=60 \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -g 60 \
  -b:v 4000k -maxrate 4000k -bufsize 8000k \
  -c:a aac -b:a 192k -ar 44100 \
  test_video.mp4
```

## Docker Development

```bash
cd docker
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## API Documentation

When backend is running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Testing Streaming

1. Upload a compatible video file
2. Create a playlist
3. Add YouTube RTMPS destination (get from YouTube Studio > Go Live)
4. Start stream
5. Monitor logs in real-time

## Troubleshooting

### FFmpeg not found
```bash
# Check FFmpeg installation
ffmpeg -version
ffprobe -version

# On macOS
brew install ffmpeg

# On Ubuntu
sudo apt-get install ffmpeg
```

### Port already in use
```bash
# Kill process on port
lsof -ti:8000 | xargs kill -9  # Backend
lsof -ti:3000 | xargs kill -9  # Frontend
```

### Video validation fails
- Check file format with: `ffprobe -v error -show_streams video.mp4`
- Ensure H.264 codec: `codec_name: h264`
- Ensure AAC audio: `codec_name: aac`
- Convert if needed (see requirements.md)

## Project Structure

```
youtube_translation/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── api/routes/          # API endpoints
│   │   ├── core/                # Configuration
│   │   ├── streaming/           # FFmpeg engine
│   │   └── models/              # Database models
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js pages
│   │   ├── components/          # React components
│   │   └── lib/                 # Utilities
│   └── package.json
└── docker/
    ├── docker-compose.yml
    └── Caddyfile
```

## Development Tips

1. **Hot Reload**: Both backend and frontend support hot reload
2. **Logs**: Check `backend/logs/` for FFmpeg output
3. **Database**: Use Supabase Studio for database management
4. **Debug**: Enable debug logging in `.env`: `LOG_LEVEL=DEBUG`

## Next Steps

- [ ] Implement Supabase authentication
- [ ] Add database models and migrations
- [ ] Build frontend components
- [ ] Test multi-channel streaming
- [ ] Deploy to production

## Resources

- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [Next.js Docs](https://nextjs.org/docs)
- [FFmpeg Docs](https://ffmpeg.org/documentation.html)
- [Supabase Docs](https://supabase.com/docs)
