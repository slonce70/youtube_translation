# Troubleshooting Guide 🔧

Common issues and their solutions for the YouTube Multi-Channel Streaming Platform.

## Table of Contents
- [Installation Issues](#installation-issues)
- [Backend Issues](#backend-issues)
- [Frontend Issues](#frontend-issues)
- [Streaming Issues](#streaming-issues)
- [Database Issues](#database-issues)
- [Authentication Issues](#authentication-issues)
- [Performance Issues](#performance-issues)

---

## Installation Issues

### Docker containers won't start

**Symptoms:**
- `docker-compose up` fails
- Containers exit immediately

**Solutions:**
1. Check Docker is running: `docker info`
2. Check ports are not in use:
   ```bash
   lsof -i :8000  # Backend
   lsof -i :3000  # Frontend
   lsof -i :1080  # tusd
   ```
3. Check environment variables:
   ```bash
   cat backend/.env
   cat frontend/.env.local
   ```
4. View container logs:
   ```bash
   docker compose -f docker/docker-compose.yml logs backend
   ```

### FFmpeg not found

**Symptoms:**
- Error: "ffmpeg binary not found"
- Streams fail to start

**Solutions:**
1. Install FFmpeg:
   ```bash
   # macOS
   brew install ffmpeg
   
   # Ubuntu/Debian
   sudo apt-get install ffmpeg
   
   # Docker (already included in image)
   ```
2. Check FFmpeg version:
   ```bash
   ffmpeg -version
   ffprobe -version
   ```

### Python dependencies fail to install

**Symptoms:**
- `pip install` errors
- Missing packages

**Solutions:**
1. Update pip:
   ```bash
   python3 -m pip install --upgrade pip
   ```
2. Use virtual environment:
   ```bash
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
3. Check Python version (3.11+ required):
   ```bash
   python3 --version
   ```

---

## Backend Issues

### Cannot connect to Supabase

**Symptoms:**
- "Invalid authentication credentials"
- Database connection errors

**Solutions:**
1. Verify Supabase credentials in `backend/.env`:
   ```env
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_KEY=eyJhbGc...
   SUPABASE_JWT_SECRET=your-jwt-secret
   DATABASE_URL=postgresql://...
   ```
2. Check Supabase project status at https://app.supabase.com
3. Verify database URL format:
   ```
   postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
4. Test connection:
   ```bash
   cd backend
   python3 -c "from app.core.database import check_db_connection; import asyncio; asyncio.run(check_db_connection())"
   ```

### Rate limit errors (429)

**Symptoms:**
- HTTP 429 Too Many Requests
- "Rate limit exceeded"

**Solutions:**
1. Wait for rate limit reset (shown in `Retry-After` header)
2. Check rate limit configuration in `app/middleware/rate_limiter.py`
3. Adjust limits for your endpoint:
   ```python
   self.limits = {
       "/api/your/endpoint": (100, 60),  # 100 req/min
   }
   ```

### Migrations fail to apply

**Symptoms:**
- Migration errors
- Database schema mismatch

**Solutions:**
1. Check migration status:
   ```bash
   cd backend
   python3 apply_migrations.py
   ```
2. View migration errors in logs
3. Manually check database schema in Supabase dashboard
4. Reset migrations (DANGER - only in development):
   ```sql
   DROP SCHEMA public CASCADE;
   CREATE SCHEMA public;
   ```

### Upload webhook fails

**Symptoms:**
- Files upload but don't appear in library
- tusd hook errors in logs

**Solutions:**
1. Check tusd is running: `curl http://localhost:1080/`
2. Verify webhook URL in tusd command:
   ```bash
   tusd -hooks-http http://backend:8000/api/assets/upload-complete
   ```
3. Check backend logs for webhook processing
4. Verify file permissions in `uploads/{user_id}/` directory

---

## Frontend Issues

### Cannot login / Authentication loops

**Symptoms:**
- Redirect loops on login
- "Session expired" immediately after login

**Solutions:**
1. Check Supabase Auth configuration:
   - Go to Supabase Dashboard → Authentication → URL Configuration
   - Add `http://localhost:3000` to Site URL
   - Add `http://localhost:3000/**` to Redirect URLs
2. Clear browser cookies and localStorage
3. Check `frontend/.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
   ```
4. Check middleware in `frontend/src/middleware.ts`

### Admin panel shows "Access Denied"

**Symptoms:**
- Cannot access `/admin/*` routes
- "Admin access required" error

**Solutions:**
1. Verify user is marked as admin in database:
   ```sql
   SELECT user_id, email, is_admin FROM user_profiles 
   WHERE email = 'your@email.com';
   ```
2. Set user as admin:
   ```bash
   cd backend
   python3 create_admin.py
   ```
3. Check admin middleware in `backend/app/api/routes/admin.py`

### Upload progress not showing

**Symptoms:**
- File uploads but no progress bar
- Upload appears stuck

**Solutions:**
1. Check browser console for errors
2. Verify tusd endpoint in Uppy configuration
3. Test tusd directly:
   ```bash
   curl -X POST http://localhost:1080/files/ \
     -H "Tus-Resumable: 1.0.0" \
     -H "Upload-Length: 1000"
   ```
4. Check CORS settings in backend

---

## Streaming Issues

### Stream won't start

**Symptoms:**
- "Failed to start stream" error
- Stream stays in "starting" status

**Solutions:**
1. Check FFmpeg is running:
   ```bash
   ps aux | grep ffmpeg
   ```
2. Verify playlist file exists:
   ```bash
   ls -l streams/playlists/
   ```
3. Check video file compatibility:
   - Must be H.264 video codec
   - Must be AAC audio codec
   - Must be yuv420p pixel format
4. View stream logs:
   ```bash
   tail -f streams/logs/stream_*.log
   ```
5. Test FFmpeg manually:
   ```bash
   ffmpeg -re -f concat -safe 0 -i playlist.txt \
     -c copy -f flv rtmps://a.rtmp.youtube.com/live2/YOUR_KEY
   ```

### Video validation fails

**Symptoms:**
- "Video not compatible for streaming"
- Validation errors in asset details

**Solutions:**
1. Check video specs with ffprobe:
   ```bash
   ffprobe -v error -show_streams your_video.mp4
   ```
2. Required specs:
   - Video codec: h264
   - Audio codec: aac
   - Pixel format: yuv420p
   - GOP size: ≤120 frames
3. Convert video if needed:
   ```bash
   ffmpeg -i input.mp4 \
     -c:v libx264 -preset fast -profile:v high -level 4.0 \
     -pix_fmt yuv420p -g 60 \
     -c:a aac -b:a 128k \
     output.mp4
   ```

### Stream keeps stopping/restarting

**Symptoms:**
- Stream disconnects frequently
- "Connection lost" errors

**Solutions:**
1. Check network stability
2. Verify YouTube stream key is correct
3. Check FFmpeg logs for errors:
   ```bash
   tail -f streams/logs/stream_*.log | grep -i error
   ```
4. Test with single destination first
5. Check system resources:
   ```bash
   htop  # CPU/RAM usage
   df -h  # Disk space
   ```

### Multiple destinations - only some work

**Symptoms:**
- Stream works for some channels but not others
- Partial stream failures

**Solutions:**
1. Verify each YouTube stream key individually
2. Check each destination has correct settings in YouTube Studio
3. Test each destination separately first
4. Check rate limits on YouTube (max concurrent streams per account)
5. Review FFmpeg tee muxer logs

---

## Database Issues

### RLS policies blocking queries

**Symptoms:**
- "Permission denied" errors
- Empty results for user's own data

**Solutions:**
1. Check RLS is enabled:
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE schemaname = 'public';
   ```
2. View RLS policies:
   ```sql
   SELECT * FROM pg_policies WHERE schemaname = 'public';
   ```
3. Test query as specific user:
   ```sql
   SET ROLE postgres;
   SET request.jwt.claims.sub = 'user-uuid-here';
   SELECT * FROM assets;
   ```
4. Temporarily disable RLS for debugging (DEV ONLY):
   ```sql
   ALTER TABLE assets DISABLE ROW LEVEL SECURITY;
   ```

### Database connection pool exhausted

**Symptoms:**
- "Too many connections" errors
- Slow database queries

**Solutions:**
1. Check active connections in Supabase dashboard
2. Increase connection pool size in `DATABASE_URL`
3. Close idle connections
4. Use connection pooler (Supabase Pooler)

---

## Authentication Issues

### JWT tokens expiring too quickly

**Symptoms:**
- Frequent "Token expired" errors
- Need to login multiple times

**Solutions:**
1. Check token expiration in Supabase Auth settings
2. Implement token refresh in frontend
3. Adjust `ACCESS_TOKEN_EXPIRE_MINUTES` in backend config

### Cannot verify JWT signature

**Symptoms:**
- "Invalid token" errors
- All authenticated requests fail

**Solutions:**
1. Verify `SUPABASE_JWT_SECRET` matches Supabase project JWT secret:
   - Supabase Dashboard → Settings → API → JWT Secret
2. Check token format (should be HS256)
3. Verify token hasn't expired:
   ```python
   import jwt
   token = "your.jwt.token"
   decoded = jwt.decode(token, options={"verify_signature": False})
   print(decoded)
   ```

---

## Performance Issues

### High CPU usage

**Symptoms:**
- CPU constantly above 80%
- System slow/unresponsive

**Solutions:**
1. Check number of active streams:
   ```bash
   ps aux | grep ffmpeg | wc -l
   ```
2. Each stream should use 2-5% CPU with `-c copy`
3. If transcoding is happening (50%+ CPU per stream):
   - Video is not H.264 compatible
   - Re-encode videos before upload
4. Monitor with:
   ```bash
   htop
   docker stats
   ```

### High memory usage

**Symptoms:**
- RAM usage constantly high
- System swapping

**Solutions:**
1. Check memory per container:
   ```bash
   docker stats
   ```
2. Limit container memory in `docker-compose.yml`:
   ```yaml
   services:
     backend:
       deploy:
         resources:
           limits:
             memory: 2G
   ```
3. Check for memory leaks in logs
4. Restart services periodically

### Slow API responses

**Symptoms:**
- API requests take >2 seconds
- Timeouts

**Solutions:**
1. Check database query performance:
   ```sql
   SELECT * FROM pg_stat_statements 
   ORDER BY mean_exec_time DESC 
   LIMIT 10;
   ```
2. Add database indexes if needed
3. Enable query caching
4. Check network latency to Supabase
5. Monitor with Prometheus metrics:
   ```bash
   curl http://localhost:8000/api/monitoring/metrics
   ```

---

## Logging and Debugging

### Enable debug logging

```bash
# Backend
cd backend
LOG_LEVEL=DEBUG python3 -m uvicorn app.main:app --reload

# Check logs
tail -f logs/*.log
```

### View all logs

```bash
# Backend logs
docker compose -f docker/docker-compose.yml logs -f backend

# Stream logs
tail -f streams/logs/*.log

# Frontend logs (dev mode)
cd frontend && npm run dev
```

### Common log locations

- Backend: `backend/logs/app.log`
- Streams: `streams/logs/stream_*.log`
- tusd: stdout (view with `docker logs`)
- Frontend: Browser console + terminal

---

## Getting Help

If you're still experiencing issues:

1. Check existing GitHub Issues
2. Enable debug logging and gather logs
3. Check system requirements
4. Review documentation in `docs/`
5. Create a new GitHub Issue with:
   - Error message
   - Logs
   - Steps to reproduce
   - System info (OS, versions)

## Useful Commands

```bash
# Check all service status
make ps

# View all logs
make logs-backend
make logs-streams

# Run health checks
curl http://localhost:8000/health
curl http://localhost:3000/api/health
curl http://localhost:1080/

# Database migrations
make migrate

# Run tests
make test
make test-backend

# Security audit
make security-audit

# Clean everything
make clean-all
```

---

**Need more help?** Check the [documentation](../README.md) or open an issue on GitHub.
