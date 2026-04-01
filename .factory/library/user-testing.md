# User Testing

Validation surfaces, setup, and concurrency guidance for this mission.

## Validation Surface

### Browser surface
Use `agent-browser` for:
- auth routing and sign-out
- dashboard shell and empty states
- library upload/folder/search/delete flows
- playlist create/edit flows
- destination and streaming UI flows
- plans/quota messaging
- admin user/alerts/settings flows

### API surface
Use `curl` for:
- auth API failure/tenant scoping checks
- quota payload verification
- playlist validation endpoint
- destination masking and cross-tenant denial
- stream quality, start/stop/status/logs
- scheduled execution and reconciliation checks

### Runtime surface
Validate against the local one-VPS baseline:
1. `postgres`
2. `redis`
3. `tusd`
4. `runner`
5. `backend`
6. `frontend`

Do not treat manager fallback as the desired acceptance baseline unless the contract explicitly allows it for a specific test.

## Validation setup notes
- Default local path uses dev auth.
- Real YouTube ingest is deferred and not part of the contract.
- Prefer `http://127.0.0.1:3100` as the browser base URL for this mission.
- For Playwright, set both `PORT=3100` and `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100`.

## Validation Concurrency

### Machine snapshot
- 8 logical CPU cores
- 8 GB RAM
- modest free headroom, with another active local project already running

### Max concurrent validators
- **Browser validators:** 1
- **API-only validators:** 2 maximum, but avoid parallel browser + heavy build work
- **Overall recommendation:** run milestone validation mostly sequentially

### Rationale
- The current machine already has meaningful memory pressure.
- Browser flows, frontend dev server, backend API, and Docker services together are heavier than the dry run alone suggests.
- Reliability is more important than validation parallelism for this mission.

## Validator reminders
- Verify one browser flow at a time.
- Prefer deterministic seeded users over ad-hoc manual state.
- When validating admin changes, always verify both admin and user-facing surfaces if the contract says the state must converge.
