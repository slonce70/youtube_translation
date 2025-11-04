# Supabase Setup Guide

## 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Choose organization
4. Enter project name: `youtube-streaming`
5. Generate strong database password
6. Select region closest to your server
7. Click "Create new project"

## 2. Run Database Migrations

1. Go to SQL Editor in Supabase Dashboard
2. Create new query
3. Copy contents of `backend/migrations/001_initial_schema.sql`
4. Run the query
5. Create another new query
6. Copy contents of `backend/migrations/002_row_level_security.sql`
7. Run the query

## 3. Get API Credentials

1. Go to Project Settings → API
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: For frontend
   - **service_role key**: For backend (keep secret!)

## 4. Get Database Connection String

1. Go to Project Settings → Database
2. Copy **Connection string** - use **Session Mode** (port 5432)
3. Replace `[YOUR-PASSWORD]` with your database password

⚠️ **IMPORTANT**: Use port **5432** (Session Mode), NOT port 6543 (Transaction Mode).
Transaction Mode is incompatible with asyncpg/SQLAlchemy async.

## 5. Configure Backend (.env)

Create `backend/.env`:

```bash
# Server
API_HOST=0.0.0.0
API_PORT=8000

# Supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_KEY=YOUR_SERVICE_ROLE_KEY

# Database (IMPORTANT: Use port 5432, NOT 6543)
DATABASE_URL=postgresql://postgres.YOUR_PROJECT:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres

# Security - Generate with: openssl rand -hex 32
SECRET_KEY=GENERATE_YOUR_OWN_SECRET_KEY_HERE

# Storage
UPLOAD_DIR=./uploads
STREAM_DIR=./streams
MAX_UPLOAD_SIZE=10737418240

# FFmpeg
FFMPEG_BIN=/usr/bin/ffmpeg
FFPROBE_BIN=/usr/bin/ffprobe

# CORS
ALLOWED_ORIGINS=http://localhost:3000
```

## 6. Configure Frontend (.env.local)

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
NEXT_PUBLIC_UPLOAD_URL=http://localhost:1080/files
```

## 7. Enable Email Auth

1. Go to Authentication → Providers
2. Enable **Email** provider
3. Disable email confirmations for development:
   - Go to Authentication → Settings
   - Toggle off "Enable email confirmations"

## 8. Test Authentication

Backend:
```bash
cd backend
python -m uvicorn app.main:app --reload
```

Frontend:
```bash
cd frontend
npm run dev
```

Visit http://localhost:3000 and try to register/login.

## 9. Storage Setup (Optional)

If using Supabase Storage for video files:

1. Go to Storage in dashboard
2. Create new bucket: `video-assets`
3. Set bucket to **Private**
4. Add RLS policies:

```sql
-- Allow authenticated users to upload
CREATE POLICY "Users can upload own files"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'video-assets' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to read own files
CREATE POLICY "Users can read own files"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'video-assets' AND
    (storage.foldername(name))[1] = auth.uid()::text
);
```

## 10. Verify Setup

Run these queries in SQL Editor to verify:

```sql
-- Check tables
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- Create test project
INSERT INTO projects (user_id, name)
VALUES ('YOUR_USER_ID', 'Test Project');
```

## Troubleshooting

### Connection refused
- Check DATABASE_URL is correct
- Verify IP is allowed in Supabase settings
- Check password is correct

### RLS blocking queries
- Make sure you're authenticated
- Check RLS policies are created
- Use service_role key for admin operations

### Email not sending
- Check spam folder
- Disable email confirmation in dev
- Use magic link instead

## Next Steps

- Set up tusd for file uploads
- Configure Caddy for HTTPS
- Deploy to production server
- Set up monitoring

## Resources

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [SQL Editor](https://supabase.com/docs/guides/database/overview)
