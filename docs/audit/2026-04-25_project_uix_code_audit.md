# Project/UIX/Code Audit — 2026-04-25

Scope: whole repository, with emphasis on the four review findings, dependency security, active documentation drift, dashboard UIX, frontend code hygiene, and current deployment structure.

## Executive summary

The original four review findings are remediated in the current codebase:

- Frontend no longer ships `next@15.5.14` / `next-intl@3.26.5`; the active stack is `next@15.5.15` and `next-intl@4.9.1`.
- Backend runtime dependencies from the original `pip-audit` report have been upgraded.
- `scripts/deploy_vps.sh` no longer includes `runner` in the Docker service allow-list.
- `docs/operations/first_stream_checklist.md` no longer tells operators to start a missing Compose `runner` service.

This audit found and fixed current drift that appeared after those remediations:

- `npm audit --omit=dev` was red again because `next` nested `postcss@8.4.31`; `frontend/package.json` now forces the audited `postcss` line to `8.5.10`.
- The root ignore list did not cover Python coverage/cache artifacts; `.gitignore` now ignores `.coverage`, `.coverage.*`, `.pytest_cache/`, `.mypy_cache/`, and `.ruff_cache/`.
- Active MediaMTX and MVP spec docs still implied a Compose `runner`; those docs now describe the real baseline: Compose infra plus backend-managed `manager` locally or host-native `systemd` stream units in the post-MVP production lane.
- Landing mobile navigation exposed an English `aria-label`; it now uses localized `landing.nav.toggleNavigation`.
- `useStreamSocket` had direct console logging despite the existing structured frontend logger; it now uses `createLogger('StreamSocket')`.
- `next build` emitted an ESLint legacy-option warning because the project uses flat config; `next.config.js` now makes the contract explicit: run `npm run lint` as the lint gate and let build handle compilation/type validity.

## Verification evidence

Commands used during the audit:

```bash
npm audit --omit=dev
npm run lint
npm test -- --runInBand
npm run type-check
npm run i18n:check
npm run build
backend/.venv/bin/pip-audit --ignore-vuln CVE-2026-3219
docker compose -f docker/docker-compose.yml config --services
rg -n '\brunner\b|15\.5\.14|next-intl@3|python-multipart==|orjson==|PyJWT==|cryptography==|pyasn1|ecdsa|docker compose.*runner|compose .*runner' .
find . -maxdepth 4 \( -name '.coverage' -o -name '.DS_Store' -o -name '*.pyc' -o -name '__pycache__' -o -name '.pytest_cache' -o -name '.next' -o -name 'node_modules' \) -print
```

Notes:

- `docker compose ... config --services` is fail-closed without `POSTGRES_PASSWORD`; this is expected for raw Compose and is documented in `README.md` / `docs/TESTING.md`. Use `make dev-bootstrap` or export `backend/.env` first.
- The local backend virtualenv reports `pip` `CVE-2026-3219`, but the configured package index currently has no fixed `pip` release. The project security target ignores only that installer advisory; app packages still fail normally.
- Browser Use covered `/`, `/dashboard`, `/dashboard/streaming`, command palette open/close, and Add Channel modal open/close/focus restoration.

## UIX audit

Current strengths:

- Landing page has a clear narrative, strong visual direction, and localized primary content.
- Dashboard empty states are understandable and action-oriented.
- Command palette is keyboard-accessible, localized, and restores focus after `Escape`.
- Add Channel modal exposes `dialog "Додати канал"`, localized labels, and returns focus to the opener.

Fixed in this pass:

- Mobile nav toggle was the only visible English accessible label on the Ukrainian landing shell.

Watch next:

- The landing theme toggle can briefly appear as `Завантаження перемикача теми`; acceptable as hydration fallback, but worth revisiting if it flashes visually on slower devices.
- Some dashboard pages are still large single-file surfaces; future UI polish should prefer smaller route-local components to make browser-tested UX changes cheaper.

## Code cleanliness and structure

Current strengths:

- Backend has meaningful domain seams: `services`, `streaming`, `schemas`, `api/routes`, and runtime guard scripts are separated.
- Frontend already extracted several streaming helpers and has focused tests around dashboard shell, command palette, localization, library, and streaming flows.
- Active docs now point to real Makefile targets and supported runtime lanes.

Residual risks:

- Large files remain: `backend/app/streaming/ffmpeg_manager.py`, `frontend/src/app/dashboard/library/page.tsx`, `frontend/src/components/upload/UploadModal.tsx`, and `frontend/src/app/dashboard/streaming/page.tsx`. They are not immediate blockers, but future work should avoid adding responsibilities there.
- Frontend still has multiple `any` casts around dynamic i18n keys, upload metadata, and legacy auth/user shapes. This is common in this codebase, but it is the next cleanup lane after release blockers.
- Historical audit docs under `docs/operations/audit-*` still describe old VPS/container states. They should remain historical, not treated as current runbooks.

## Deployment/documentation status

Current supported Compose services:

- `postgres`
- `redis`
- `backend`
- `tusd`
- `frontend`
- `mediamtx`

No active deployment script should select a Compose `runner` service. The term `runner` is still valid only for the logical FFmpeg execution role or historical audit notes.

## Recommended next cleanup lanes

1. Split `frontend/src/app/dashboard/library/page.tsx` into route-local panels/hooks once a new library feature touches it.
2. Split `frontend/src/components/upload/UploadModal.tsx` around Uppy setup, media analysis, and presentational modal sections.
3. Replace broad frontend `any` usage with typed translation-key helpers and typed metadata accessors.
4. Add a doc-drift test that asserts MediaMTX bootstrap docs list exactly the Compose services started by `make dev-bootstrap-v2`.
5. Decide whether historical VPS audit docs need a top-of-file “historical snapshot” banner to prevent operator confusion.
