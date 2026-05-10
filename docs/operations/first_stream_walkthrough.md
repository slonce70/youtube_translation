# First Stream — End-to-End Walkthrough (Track B)

Real-stream verification run on **2026-04-26** with the operator's actual
YouTube channel and a representative test file. This document captures the
sequence that worked, the bugs surfaced and fixed, and the panel UX gaps
that should drive the next track of work.

## Setup

Local development stack on macOS (Apple Silicon):
- Postgres 16 listening on `:5432`, user `youtube_user`, db `youtube_streaming`.
- ffmpeg 8.1 + ffprobe at `/opt/homebrew/bin/`.
- Backend `./start-backend.sh` → uvicorn :8000, `STREAM_RUNTIME_MODE=manager`,
  `ENABLE_DEV_AUTH=true`.
- tusd `./start-tusd.sh` → :1080.
- Frontend via `.claude/launch.json` → :3456 with `NEXT_PUBLIC_API_URL=/api`,
  `ENABLE_API_PROXY=1`, `DEV_API_PROXY_TARGET=http://127.0.0.1:8000`,
  `NEXT_PUBLIC_DEV_BYPASS_AUTH=1`.

**`.claude/launch.json` had a stale `NEXT_PUBLIC_API_URL=http://127.0.0.1:8765/api`
override that pointed at a port nothing listens on.** Fixed in this session — all
calls now correctly proxy through Next.js to the backend on :8000.

Test file: `/Users/trend/Documents/Трансляція відео/IMG_1331.MP4`
- H.264 video, 1280×720, 30 fps, 7 min 12 s, 158 MB, AAC stereo @ 44.1 kHz.

Test destination: live YouTube ingest, key supplied by the channel owner for
this test (rotated immediately after).

## Step 1 — Raw FFmpeg pre-flight

Always start with the raw command **before** involving the panel. If this
fails, the panel can't help.

```bash
ffmpeg -hide_banner -re \
  -i "/Users/trend/Documents/Трансляція відео/IMG_1331.MP4" \
  -c copy -f flv -t 30 \
  "rtmps://a.rtmps.youtube.com/live2/<KEY>"
```

Result (truncated): `frame=902 fps=30 q=-1.0 Lsize=11751KiB time=00:00:30.04
bitrate=3203.9kbits/s speed=0.988x`. RTMPS handshake to
`a.rtmps.youtube.com` succeeded; H.264+AAC passthrough at ~3.2 Mbps held
real-time (`speed=1.0x`); the Cyrillic path component caused no parsing
issues; clean exit code 0. **Pipeline OK.**

## Step 2 — Through the panel

In order:

1. `/dashboard/channels` → "Додати канал" → name "YouTube — Test", URL
   `rtmps://a.rtmps.youtube.com/live2/`, key from YouTube Studio. Submit.
2. `/dashboard/library` → upload the test file via tusd (or place under
   `backend/uploads/<user_id>/` and seed an `assets` row pointing at the
   absolute path).
3. `/dashboard/streaming` → "+ Нова трансляція" → pick the channel + asset,
   name "Smoke test", start mode "now", click Запустити.

Live verification:
- `GET /api/streams/<id>/status` returned `status=running`, healthy, uptime
  ticking, `runtime_restart.attempts=0`, `provider_status="unknown"` (the
  YouTube provider polling kicks in 30 s after start).
- `pgrep -fl ffmpeg` showed the expected concat-demuxer command:
  `ffmpeg -stream_loop -1 -re -f concat -safe 0 -i streams/<id>/video.ffconcat
  -map 0:v:0 -map 0:a:0? -c:v copy -bsf:v h264_mp4toannexb -tag:v 7 -c:a copy
  -tag:a 10 -f fifo -fifo_format flv … rtmps://a.rtmps.youtube.com/live2/<KEY>`.
- The dashboard's Live tab showed:
  - Status pill "● У ЕФІРІ" + start time.
  - "1 Live" badge in the global topbar.
  - Stat strip: 1 Активних ефірів, 1/1 Паралельний ліміт, 1/1 Каналів додано.
  - Per-stream card with "Зараз програється: Черга (1)", progress bar, "8% відтворено · Цикл увімк."

Stop via panel button, OR via the
`POST /api/streams/<id>/stop` endpoint — verified the FFmpeg process exits
cleanly with no orphan.

## Bugs surfaced and fixed

### BUG-1 — Free-tier gate rejected `rtmps.youtube.com` host
- **Where:** `backend/app/core/quota.py` `ensure_destination_allowed()`.
- **Symptom:** POST `/api/destinations/` with URL
  `rtmps://a.rtmps.youtube.com/live2/` → `403 custom_rtmps_not_allowed`.
- **Root cause:** check was `hostname.endswith("rtmp.youtube.com")`. Both
  `rtmp.youtube.com` and `rtmps.youtube.com` are official YouTube ingest
  hostnames (a.rtmps.* has been the recommended secure ingest since 2020),
  but the strict check rejected the secure variant.
- **Fix:** accept both hostnames on the free tier (commit `31a4a40`).

## Panel UX gaps surfaced (feeds Track D backlog)

These are not bugs — the streaming pipeline works — but the friction the
panel makes the operator walk through is high. Each line is a candidate for
the modern-panel rebuild.

1. **Custom RTMPS URL placeholder mismatched the actually-recommended host.**
   Fixed in the default form/schema values after this walkthrough: new channels
   now pre-fill `rtmps://a.rtmps.youtube.com/live2`. Previously the form used
   `rtmps://a.rtmp.youtube.com/live2` (no `s` after `rtmp`)
   while YouTube's own docs say to use `rtmps://a.rtmps.youtube.com/live2/`.
   Both hosts continue to validate so existing saved channels are not broken.

2. **Stream creation accepts `asset_ids` but the UI/forms still talk in
   "stream_assets" elsewhere.** Different entry points use different shapes
   for "the playlist of assets to play". Document one, deprecate the other.

3. **Quality-gate wants metadata fields (`asset.meta.video.bitrate`,
   `asset.bitrate`, codec_info, fps, height, width) that aren't always
   populated by the upload pipeline.** Today an asset created without
   ffprobe-derived metadata can pass library validation but fails at
   stream-start with `bitrate_missing` / `missing_metadata`. Either the
   upload finalize step should always populate these, OR the quality gate
   should fall back to running `ffprobe` on demand when metadata is missing.

4. **`storage_backend` legal values are `filesystem` / `object_storage`.
   Manually-inserted assets with `storage_backend='local'` produce
   `Unsupported asset storage backend: local` at start time** — a different
   error than the validation layer raises. Pin valid values in one place
   (Pydantic Literal already does, but DB constraint is missing).

5. **`storage_path` validator requires absolute paths under
   `<UPLOAD_DIR>/<user_id>/`.** Documented, but the error message
   "Asset storage_path must be within the user's upload directory" doesn't
   say what the expected shape is. Show the expected prefix in the error.

6. **Rate limiter at start-stream blocks rapid retries with `429
   retry_after=35`.** Reasonable for production, but during initial
   onboarding/debugging the operator hits this often. Surface a clear
   countdown in the toast; consider exempting the start endpoint when
   `is_running=false` AND the previous start failed within 60 s.

7. **`GET /api/streams/<id>/status` returns `status="running"` and
   `is_running=false` after FFmpeg exits unexpectedly.** Operator sees a
   "live" pill while nothing is actually streaming. The stream reconciler
   reconciles eventually, but the status surface should reflect reality
   sooner — e.g. derive a "discrepancy" state and surface it.

8. **No "now playing" for the operator.** The status payload includes total
   duration but not "current asset / position / next-up". The frontend
   computes a fake progress bar from the total duration. (Track C will fix
   this — surface `current_asset_*`, `next_asset_*` from `hot_swap.py`.)

9. **Live bitrate / fps / dropped-frames are not exposed.** `ffmpeg_manager`
   captures stderr but doesn't parse metric lines. Sparkline visuals on the
   modern panel need a `/api/streams/<id>/metrics?samples=60` endpoint
   feeding from a 1-Hz sliding window.

10. **No incident timeline view.** `StreamEvent` rows exist in DB; the
    frontend only sees them indirectly via `extractStopAuditEntries` from
    the logs file. Expose `/api/streams/<id>/events?limit=50` ordered by
    severity + time.

11. **Stop endpoint is rate-limited under same bucket as start.** A failing
    stop (because of network hiccup) costs an operator their stop budget for
    a minute. Decouple stop from start in the rate limiter.

12. **CSRF cookie must already be present for the first POST.** First-page
    visit triggers `csrftoken` from the GET response, but the panel's
    `useStreamMutations` doesn't always do a warm GET before the first
    write. UX-wise, an immediate "+ Add channel" on a brand-new tab can
    fail with a generic 403. Either prime the cookie in `app/layout.tsx`
    on mount, or auto-retry once on 403 with a fresh cookie.

## Recommended panel changes (drives Track D)

Sorted by operator value-vs-effort:

1. **Surface "now playing" + "up next" + per-asset progress** (depends on
   Track C #2/#3). Single biggest operator value — answers "what's on air?"
   without leaving the panel.
2. **Hero status pill + tab title + favicon flip green/red** — answers
   "is it up?" without reading any text.
3. **Live metrics tiles with sparklines** (depends on Track C #1) — bitrate,
   fps, drops, viewers.
4. **Inline incident timeline** (depends on Track C #4) — replaces the
   modal-only logs view; persistent, deep-linkable, severity-tagged.
5. **One-click restart with 5 s undo toast** — no confirmation modal.
6. **First-run wizard** if no channel + no asset yet — three steps with
   smart defaults; replaces the current empty-state cascade.
7. **Auto-prime CSRF cookie before first write** — eliminates a confusing
   first-write 403.

## Repro

Append the following to your local notes for next time:

```bash
# Backend + tusd up (one terminal each)
./start-backend.sh
./start-tusd.sh

# Frontend (separate terminal)
cd frontend && NEXT_PUBLIC_DEV_BYPASS_AUTH=1 npm run dev -- --port 3456

# Pre-flight raw stream
ffmpeg -hide_banner -re -i "<file>" -c copy -f flv -t 30 \
  "rtmps://a.rtmps.youtube.com/live2/<KEY>"

# If raw works, walk through the panel:
# 1) /dashboard/channels  →  Add channel
# 2) /dashboard/library    →  Upload file
# 3) /dashboard/streaming  →  New stream  →  Start
```

Stream key was rotated immediately after this test.
