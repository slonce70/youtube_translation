# Troubleshooting

## `make dev-bootstrap` fails on port ownership

Cause:
- `127.0.0.1:5432` or `127.0.0.1:6379` is already occupied by a non-Compose service

What to do:
- stop the conflicting local service and rerun `make dev-bootstrap`
- or use the explicit local fallback path when you really intend to test against host-owned services: `make verify-mvp-localdb`

## `make verify-v0` or `make verify-mvp` fails before backend tests start

Cause:
- the canonical backend test path refuses to use arbitrary host-owned `postgres` or `redis`

What to do:
- free the conflicting ports and rerun the canonical gate
- or use `make verify-mvp-localdb` for a deliberate local fallback

## Playwright smoke behaves differently from manual DEV auth

Cause:
- managed Playwright smoke forces `NEXT_PUBLIC_DEV_BYPASS_AUTH=0` when it launches its own local Next server

What to do:
- use DEV auth for quick manual dashboard smoke
- use `npm run test:e2e` or the `verify-mvp*` targets for deterministic redirect checks

## Uploads fail because tusd URL is wrong

Cause:
- `NEXT_PUBLIC_TUSD_URL` includes `/files` even though the frontend helper already appends it

What to do:
- point `NEXT_PUBLIC_TUSD_URL` to the tusd origin only, for example `http://localhost:1080`

## Real auth sanity check is failing

Cause:
- DEV bypass is still enabled
- Supabase credentials are missing or invalid

What to do:
- disable `NEXT_PUBLIC_DEV_BYPASS_AUTH`
- confirm `SUPABASE_URL`, `SUPABASE_KEY`, and `SUPABASE_JWT_SECRET`
- retry the login flow before moving on to stream rehearsal

## First stream does not reach a stable `running` state

What to do:
- use `docs/operations/first_stream_checklist.md`
- verify the asset is H.264/AAC compatible
- verify the destination is enabled and the RTMPS credentials are correct
- inspect backend logs and stream logs before retrying

## systemd stream worker crashes on `supervisor_*` env validation

Cause:
- the host `backend/.env` still contains legacy `SUPERVISOR_*` keys from the pre-systemd runtime era

What to do:
- update to a build that accepts these legacy keys during transition
- remove stale `SUPERVISOR_*` lines from the production `backend/.env` during the next config cleanup
- rerun the canary stream after the backend restart

## Do we need `systemd` before MVP?

No.

`systemd` is a post-MVP rollout lane for Linux production hardening.
The final MVP bar is the single-node, single-destination path plus real auth sanity and first-stream rehearsal.
