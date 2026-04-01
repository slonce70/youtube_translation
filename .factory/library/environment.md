# Environment

Environment variables, external dependencies, and setup notes for this mission.

## What belongs here
- Required env files and key variables
- Local setup assumptions
- External dependency notes
- Environment-specific gotchas

## Required local files
- `backend/.env`
- `frontend/.env.local`

If missing, workers may create them from examples, but must never commit secrets.

## Local validation baseline
- Backend: `API_PORT=8000`
- Frontend: `FRONTEND_PORT=3100`
- tusd: `1080`
- Postgres: `5432`
- Redis: `6379`
- Runner supervisor control: `9001`

## Important environment assumptions
- Default local validation uses:
  - `ENABLE_DEV_AUTH=true` in backend
  - `NEXT_PUBLIC_DEV_BYPASS_AUTH=1` in frontend
- If `DEV_USER_EMAIL` or `DEV_USER_ID` are unset, backend DEV auth falls back to `dev@example.com` and `00000000-0000-0000-0000-000000000001`.
- Local runtime quality/start checks depend on migrated and seeded `subscription_tier_limits` data for the active user's tier; otherwise `/api/streams/{id}/quality` and launch preflight can fail with `Invalid subscription tier` HTTP 500s instead of actionable runtime validation errors.
- Real YouTube E2E is deferred for this mission.
- Manual plans are the only V1 billing path.

## High-signal backend variables
- `DATABASE_URL`
- `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_JWT_SECRET`
- `ENABLE_DEV_AUTH`, `DEV_USER_EMAIL`, `DEV_USER_ID`
- `STREAM_RUNTIME_MODE`
- `ALLOW_UNSAFE_MANAGER_RUNTIME`
- `STREAM_RUNTIME_*`
- `FFMPEG_BIN`, `FFPROBE_BIN`
- `TUSD_HMAC_SECRET`, `UPLOAD_TOKEN_SECRET`

## High-signal frontend variables
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_TUSD_URL`
- `NEXT_PUBLIC_DEV_BYPASS_AUTH`
- `NEXT_PUBLIC_DEV_USER_ID`
- `NEXT_PUBLIC_DEV_USER_EMAIL`
- `PLAYWRIGHT_BASE_URL`
- `PORT` for local `next dev`

## Known local gotchas
- Port `3000` is occupied by another project; mission work must use `3100` for frontend flows and Playwright.
- Host `ffmpeg` is not installed in this environment; local production-like runtime validation should rely on the Docker runner path or backend test stub where appropriate.
- `.gitignore` already excludes `backend/.env` and `frontend/.env.local`; keep it that way.
