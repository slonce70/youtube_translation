# Remediation Plan

## Critical Findings

1. **Unauthenticated Upload Metadata**  
   `backend/app/services/assets/upload_service.py` trusts the `user_id` metadata coming from tusd, which the frontend sets via `uppy.setMeta`. An attacker can spoof another tenant’s UUID and have files recorded under that user.

2. **Unauthenticated tusd Hooks**  
   The post-finish webhook endpoint (`/api/assets/upload-complete`) accepts unsigned payloads. Anyone who can reach the API can point to any file path and create assets, bypassing quota and impersonating users.

3. **Admin Force-Stop Not Awaited**  
   `AdminService.force_stop_stream` calls `ffmpeg_manager.stop_stream` without `await`, so the coroutine never runs and streams keep pushing video even though the admin UI shows them as stopped.

4. **Stream Queue Writes Before Runtime Acceptance**  
   `StreamService.enqueue_stream_asset` commits DB changes before verifying the running stream accepted the hot swap, leading to DB/runtime drift when enqueue fails.

5. **Frontend Cache Leaks Between Users**  
   React Query caches (e.g., `['quota']`, `['streams']`) persist across logouts, so a second Supabase login temporarily sees the previous user’s data.

## Remediation Steps

1. **Secure tus Upload Pipeline**
   - Issue signed upload tokens per user/session and require tus clients to provide them instead of blindly trusting `user_id` metadata.
   - HMAC-sign post-finish hook payloads with `TUSD_HMAC_SECRET` and validate them in FastAPI before persisting assets.
   - Verify metadata (user, file path) server-side before creating assets; reject spoofed uploads.

2. **Fix Admin Stream Control**
   - `await` the async `stop_stream` coroutine and bubble errors to the caller.
   - Prefer routing admin force-stops through `StreamControlService` for consistent supervisor/systemd handling.

3. **Make Hot-Swap Writes Transactional**
   - Wrap `enqueue_stream_asset` in a single transaction: stage DB changes, attempt the hot swap, commit only if runtime accepts; rollback otherwise.

4. **Clear Frontend Cache on Sign-Out / Scope by User**
   - Include `user.id` in every React Query key and/or call `queryClient.clear()` when signing out so cached quota/stream data can’t leak to the next user.

5. **Polish UI Issues**
   - Wire the "Remind me later" button in `SubscriptionBanner` to actually dismiss/snooze the banner.
   - Add pagination controls to the admin dashboard (users/streams/alerts) so more than 1000 records can be managed.

6. **Verification**
   - After changes, run backend tests (`pytest`), frontend lint/tests (`npm run lint && npm test`), and manual flows: tus upload with signed metadata, admin force-stop, multi-user login/logout, stream hot-swaps.
