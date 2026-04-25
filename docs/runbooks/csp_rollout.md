# Runbook — CSP rollout (Report-Only → enforce)

How to flip the frontend Content-Security-Policy from `Report-Only`
(default) to enforce-mode without breaking the app.

The CSP is set in `frontend/next.config.js` via the `headers()` callback.
Mode is gated on the `CSP_MODE` environment variable read at config-load
time (see Sprint-1 commit `768532a`):

| `CSP_MODE` value | Header emitted |
|---|---|
| (unset) or `report-only` | `Content-Security-Policy-Report-Only` |
| `enforce` | `Content-Security-Policy` |
| `disabled` | (no CSP header — other security headers stay) |

**`CSP_MODE` is read at process start.** Changing the env var requires
restarting the frontend service (Compose: `docker compose restart frontend`;
host-native: `systemctl restart youtube-frontend.service`). A reload is
not enough — Next.js bundles the resolved value into the standalone
server.

## When to flip

- Two consecutive 24-hour periods with **zero** CSP-Report-Only
  violations in production traffic.
- All known third-party endpoints (Supabase project URL, YouTube
  thumbnail CDN, your backend WSS origin) are explicitly listed in the
  CSP source-list overrides.
- A rollback path is rehearsed (revert `CSP_MODE=enforce` → `CSP_MODE=report-only`,
  restart, traffic recovers within seconds).

## Phase 1 — Set up the report endpoint

```
# In /etc/youtube-streaming/frontend.env
CSP_MODE=report-only
CSP_REPORT_URI=/api/csp-report
```

The optional `CSP_REPORT_URI` is appended to the CSP as `report-uri`,
which causes browsers to POST violation JSON. Wire `/api/csp-report` to
Sentry or to the backend's structured logger — anywhere that you can
review aggregated violations.

If you do not have a report sink, the rule still works without
`CSP_REPORT_URI`; you just have to read the browser DevTools console on
each route to spot violations during pre-flip review.

## Phase 2 — Walk every route under Report-Only

Open each of these in DevTools, hard-reload, and watch for
`Content Security Policy` entries in the Console tab:

- `/` (landing)
- `/login`
- `/dashboard`
- `/dashboard/streaming`
- `/dashboard/library`
- `/dashboard/playlists` (redirects to library)
- `/dashboard/destinations` (redirects to streaming)
- `/dashboard/profile`
- `/dashboard/plans`
- `/dashboard/schedule`
- `/admin`
- `/admin/users`
- `/admin/streams`
- `/admin/alerts`
- `/admin/settings`

Common violations and their fixes:

- `Refused to connect to 'https://abc-project.supabase.co/...' because it
  violates the following Content Security Policy directive: connect-src 'self' ...`
  → Set `NEXT_PUBLIC_SUPABASE_URL` so `next.config.js` pins the project
  URL into `connect-src` (the default uses `https://*.supabase.co`).
- `Refused to load image 'https://i.ytimg.com/...' ...`
  → `i.ytimg.com` is in the default `img-src`. If you see this with
  another YouTube CDN host, add it to the `IMG_SOURCES` list in
  `next.config.js`.
- `Refused to connect to 'wss://your-backend.example/api/streams/.../events' ...`
  → Set `NEXT_PUBLIC_BACKEND_WSS=wss://your-backend.example` so the
  origin is added to `connect-src`.

For each fix, redeploy and re-check until the route is silent.

## Phase 3 — Flip to enforce

```
# /etc/youtube-streaming/frontend.env
CSP_MODE=enforce
CSP_REPORT_URI=/api/csp-report   # keep the reporter; rare violations are now blocks, not warnings
```

```bash
systemctl restart youtube-frontend.service
# OR
docker compose restart frontend
```

Verify the header flipped:

```bash
curl -sI https://yourdomain.example/dashboard | grep -i 'content-security-policy'
# Expect: Content-Security-Policy: default-src 'self'; script-src ...
# (NOT Content-Security-Policy-Report-Only)
```

## Rollback

If users start reporting blank pages or broken interactions after the
flip:

```bash
# Same env file
CSP_MODE=report-only
```

```bash
systemctl restart youtube-frontend.service
```

Browsers re-render with the same CSP rules but in report-only mode —
violations log without blocking. Investigate the violation report
inventory and fix the source-list before re-attempting Phase 3.

## Notes

- `'unsafe-inline'` in `script-src` is currently required by Next.js
  App Router's inline hydration scripts. Removing it requires wiring
  a per-request CSP nonce — tracked as a Sprint 5 follow-up. **The
  current CSP is transport hardening (HSTS, frame-ancestors, plugin
  block, upgrade-insecure-requests), not XSS mitigation.**
- HSTS is emitted only in production (`NODE_ENV=production`); a dev
  hit over `https://localhost` (e.g. mkcert) will not pin the entire
  localhost zone for 2 years. See `next.config.js::buildSecurityHeaders`.

## Related

- `frontend/next.config.js` — CSP construction.
- `docs/audit/2026-04-25_deep_multi_agent_audit.md` — H7 finding that
  motivated this work.
