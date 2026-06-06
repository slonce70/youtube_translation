# Full Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the audited YouTube streaming platform back to a secure, testable, deployment-truthful baseline.

**Architecture:** Keep the existing FastAPI service, Next.js App Router frontend, Docker/systemd runtime split, and Supabase-auth boundary. Fix high-risk drift first: dependency advisories, env contract gaps, Playwright auth/cold-start fragility, stale deploy automation, proxy CSP mismatch, and React correctness/accessibility debt.

**Tech Stack:** Python 3.12, FastAPI, async SQLAlchemy, PostgreSQL, Redis, tusd, FFmpeg, Next.js 15/React 19, next-intl, Jest, Playwright, Docker Compose, GitHub Actions.

---

## Audit Baseline

Current branch: `main...origin/main`, clean before writing this plan.

Green checks observed:
- `cd frontend && npm run lint`
- `cd frontend && npm run type-check`
- `cd frontend && npm run i18n:check`
- `cd backend && .venv/bin/python -m black --check app/`
- `cd backend && .venv/bin/python -m mypy --config-file mypy.ini`
- `set -a; [ -f backend/.env ] && . backend/.env; set +a; docker compose -f docker/docker-compose.yml config --quiet`
- `make test-backend-localdb`: `510 passed, 10 skipped`
- `cd frontend && CI=1 npm test`: `46 passed suites, 172 passed tests`
- `cd frontend && npm run build`: exit code `0`
- `cd frontend && PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 NEXT_PUBLIC_DEV_BYPASS_AUTH=0 npx playwright test --reporter=list --workers=1`: `5 passed`

Known verification caveats:
- `make test` failed before tests because `127.0.0.1:5432` was occupied by a non-Compose Postgres, as intended by `Makefile:146-154`.
- Cold managed `cd frontend && npm run test:e2e` failed once on landing CTA visibility after dev-server compile/loading exceeded the default 5s expect timeout.
- Warm `PLAYWRIGHT_BASE_URL` run against a dev server started with `.env.local` bypass failed auth redirect checks, because `playwright.config.ts:14-24` only forces bypass off for managed servers.
- `npm run build` printed `ESLint: Invalid Options: useEslintrc, extensions`; standalone ESLint passed, so the build-time lint integration is noisy/invalid while CI still has an explicit lint step.

Security/dependency audit:
- `cd frontend && npm audit --omit=dev` found 5 production advisories: `next` high, `next-intl` moderate, `postcss` moderate, `ws` moderate, `icu-minify` low.
- `cd backend && .venv/bin/pip-audit` found 15 advisories in 7 packages: `idna`, `mako`, `pip`, `pyjwt`, `python-multipart`, `starlette`, `urllib3`.
- `npx -y react-doctor@latest . --verbose` in `frontend/` scored `52 / 100 Critical`: 394 issues, including 12 bug errors, 4 security warnings, 70 accessibility warnings, and large component/state debt.

Product/deploy drift:
- `.github/workflows/deploy-vps.yml:11-19` still deploys on push to `main`, hourly schedule, and manual dispatch.
- Prior memory said obsolete VPS autodeploy had been removed, so this repository state conflicts with earlier operational context. Treat the current file as real until deployment ownership is reverified.

## File Structure

Modify these files during remediation:
- `backend/requirements.txt` - backend dependency pins for advisory fixes.
- `backend/.env.example` - documented env contract for all non-obvious `Settings` fields.
- `backend/tests/test_env_example_contract.py` - regression test that required production/security env keys remain documented.
- `frontend/package.json` and `frontend/package-lock.json` - frontend dependency remediation and scripts.
- `frontend/playwright.config.ts` - stable e2e auth mode and timeout.
- `frontend/e2e/smoke.spec.ts` - resilient landing/login/dashboard smoke assertions.
- `frontend/next.config.js` - suppress invalid build-time ESLint integration after preserving explicit `npm run lint`.
- `docker/Caddyfile.template` and generated `docker/Caddyfile` - align proxy CSP with frontend CSP posture.
- `.github/workflows/deploy-vps.yml` - quarantine automatic triggers unless production ownership is proven.
- `.pre-commit-config.yaml` - align frontend hook versions with Next 15/Node 24 or remove stale duplicate frontend lint path.
- `docs/operations/deployment-status.md` - persistent deployment ownership record.
- `docs/operations/security-audit-followup.md` - dependency and formal security-scan follow-up ledger.

## Task 1: Dependency Advisory Remediation

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `docs/operations/security-audit-followup.md`

- [ ] **Step 1: Create a dependency branch**

Run:

```bash
git switch -c codex/audit-dependency-remediation
```

Expected: branch changes from `main` to `codex/audit-dependency-remediation`.

- [ ] **Step 2: Update backend pins with audit fix versions**

Modify `backend/requirements.txt` so these pins are present:

```txt
fastapi==0.136.3
python-multipart==0.0.27
PyJWT==2.13.0
Mako==1.3.12
idna==3.15
urllib3==2.7.0
starlette==1.0.1
```

Keep existing project-specific pins that are not listed above. `starlette==1.0.1` is an explicit direct pin because `fastapi==0.136.3` only requires `starlette>=0.46.0` in pip dry-run output.

- [ ] **Step 3: Reinstall backend dependencies**

Run:

```bash
cd backend
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
```

Expected: resolver succeeds and `pip` is at least `26.1.2`.

- [ ] **Step 4: Update frontend production dependency lock**

Run:

```bash
cd frontend
npm audit fix --omit=dev
```

Expected: `package-lock.json` changes. Review any framework major bump before continuing; keep `NEXT_PUBLIC_DEV_BYPASS_AUTH=0` production build behavior intact.

- [ ] **Step 5: Write the security follow-up ledger**

Create `docs/operations/security-audit-followup.md` with this content:

```markdown
# Security Audit Follow-up

Date: 2026-06-06

## Package Advisories

- Backend: resolved through `backend/requirements.txt` pin updates and `.venv` reinstall.
- Frontend: resolved through `npm audit fix --omit=dev`.

## Formal Scan

Run a Codex Security repository-wide scan before production sign-off. Required workflow:
1. Threat model.
2. Finding discovery.
3. Validation.
4. Attack-path analysis.
5. Markdown and HTML final reports.

## Sign-off Gates

- `cd backend && .venv/bin/pip-audit`
- `cd frontend && npm audit --omit=dev`
- `RUN_BLACK=1 make lint-backend`
- `cd backend && .venv/bin/python -m mypy --config-file mypy.ini`
- `make test-backend-localdb`
- `cd frontend && npm run lint && npm run type-check && CI=1 npm test && npm run build && NEXT_PUBLIC_DEV_BYPASS_AUTH=0 npm run test:e2e`
```

- [ ] **Step 6: Verify advisories are gone**

Run:

```bash
cd backend && .venv/bin/pip-audit
cd ../frontend && npm audit --omit=dev
```

Expected: both commands return exit code `0`. If a transitive advisory remains, record the package, parent, and blocker in `docs/operations/security-audit-followup.md`.

- [ ] **Step 7: Run compatibility tests**

Run:

```bash
RUN_BLACK=1 make lint-backend
cd backend && .venv/bin/python -m mypy --config-file mypy.ini
make test-backend-localdb
cd frontend && npm run lint && npm run type-check && CI=1 npm test && npm run build
```

Expected: all pass.

- [ ] **Step 8: Commit dependency remediation**

Run:

```bash
git add backend/requirements.txt frontend/package.json frontend/package-lock.json docs/operations/security-audit-followup.md
git commit -m "fix: remediate audited dependency advisories"
```

## Task 2: Backend Env Contract Coverage

**Files:**
- Modify: `backend/.env.example`
- Create: `backend/tests/test_env_example_contract.py`

- [ ] **Step 1: Write a failing env-contract test**

Create `backend/tests/test_env_example_contract.py`:

```python
from pathlib import Path


REQUIRED_ENV_EXAMPLE_KEYS = {
    "CSRF_SECRET",
    "DISK_CRITICAL_PERCENT",
    "DISK_WARNING_PERCENT",
    "DOWNLOAD_TOKEN_TTL_SECONDS",
    "ENCRYPTION_KEY_PREVIOUS",
    "FFMPEG_OUTPUT_DROP_PKTS_ON_OVERFLOW",
    "FFMPEG_OUTPUT_FIFO_QUEUE_SIZE",
    "FFMPEG_OUTPUT_RW_TIMEOUT_US",
    "FFMPEG_OUTPUT_TCP_KEEPALIVE",
    "FFMPEG_RESTART_BACKOFF_MAX_SECONDS",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_SCOPES",
    "PLAYLIST_SHUFFLE_SEED_MODE",
    "REDIS_RATE_LIMIT_PREFIX",
    "REDIS_URL",
    "STREAM_LOG_MAX_BACKUPS",
    "STREAM_LOG_MAX_BYTES",
    "STREAM_SCHEDULE_POLL_INTERVAL_SECONDS",
    "STREAM_SCHEDULE_RETRY_INTERVAL_SECONDS",
    "SUPABASE_SERVICE_KEY",
    "UPLOAD_TOKEN_TTL_SECONDS",
    "USER_CACHE_MAX_SIZE",
    "WS_TOKEN_SECRET",
    "WS_TOKEN_TTL_SECONDS",
    "YOUTUBE_OAUTH_STATE_SECRET",
    "YOUTUBE_PROVIDER_HTTP_TIMEOUT_SECONDS",
    "YOUTUBE_PROVIDER_STATUS_TTL_SECONDS",
}


def _env_keys(path: Path) -> set[str]:
    keys: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        keys.add(line.split("=", 1)[0].strip())
    return keys


def test_security_and_runtime_settings_are_documented_in_env_example() -> None:
    env_example = Path(__file__).resolve().parents[1] / ".env.example"
    missing = REQUIRED_ENV_EXAMPLE_KEYS - _env_keys(env_example)
    assert missing == set()
```

- [ ] **Step 2: Run test and confirm it fails**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_env_example_contract.py -v
```

Expected: FAIL with missing keys.

- [ ] **Step 3: Add missing keys to `backend/.env.example`**

Insert these blocks into the matching existing sections:

```dotenv
# Optional service key for server-side Supabase admin operations. Leave empty unless a feature explicitly needs it.
SUPABASE_SERVICE_KEY=

# Token TTLs
DOWNLOAD_TOKEN_TTL_SECONDS=300
UPLOAD_TOKEN_TTL_SECONDS=900
WS_TOKEN_SECRET=
WS_TOKEN_TTL_SECONDS=60
CSRF_SECRET=
ENCRYPTION_KEY_PREVIOUS=

# FFmpeg resilience and log retention
FFMPEG_RESTART_BACKOFF_MAX_SECONDS=60
FFMPEG_OUTPUT_FIFO_QUEUE_SIZE=240
FFMPEG_OUTPUT_DROP_PKTS_ON_OVERFLOW=true
FFMPEG_OUTPUT_RW_TIMEOUT_US=15000000
FFMPEG_OUTPUT_TCP_KEEPALIVE=true
STREAM_LOG_MAX_BYTES=52428800
STREAM_LOG_MAX_BACKUPS=5
PLAYLIST_SHUFFLE_SEED_MODE=deterministic
USER_CACHE_MAX_SIZE=512

# Scheduler
STREAM_SCHEDULE_POLL_INTERVAL_SECONDS=15
STREAM_SCHEDULE_RETRY_INTERVAL_SECONDS=60

# Redis rate limiting
REDIS_URL=redis://localhost:6379/0
REDIS_RATE_LIMIT_PREFIX=rate-limit

# YouTube OAuth / provider status
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/api/youtube/oauth/callback
GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/youtube.readonly
YOUTUBE_OAUTH_STATE_SECRET=
YOUTUBE_PROVIDER_STATUS_TTL_SECONDS=30
YOUTUBE_PROVIDER_HTTP_TIMEOUT_SECONDS=15

# Disk alert thresholds
DISK_WARNING_PERCENT=80
DISK_CRITICAL_PERCENT=90
```

- [ ] **Step 4: Verify the env contract**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_env_example_contract.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit env contract fix**

Run:

```bash
git add backend/.env.example backend/tests/test_env_example_contract.py
git commit -m "test: document backend environment contract"
```

## Task 3: Playwright Cold-start and Auth-mode Stabilization

**Files:**
- Modify: `frontend/playwright.config.ts`
- Modify: `frontend/e2e/smoke.spec.ts`
- Modify: `docs/TESTING.md`

- [ ] **Step 1: Update Playwright config**

Replace `frontend/playwright.config.ts` with:

```ts
import { defineConfig } from '@playwright/test'

const tusdUrl = process.env.NEXT_PUBLIC_TUSD_URL ?? 'http://localhost:1080'
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
const usesManagedLocalServer = process.env.PLAYWRIGHT_BASE_URL === undefined

process.env.NEXT_PUBLIC_TUSD_URL = tusdUrl

if (!usesManagedLocalServer && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1') {
  throw new Error(
    'PLAYWRIGHT_BASE_URL points at an existing server, but NEXT_PUBLIC_DEV_BYPASS_AUTH=1. ' +
      'Restart the server with NEXT_PUBLIC_DEV_BYPASS_AUTH=0 or unset PLAYWRIGHT_BASE_URL.'
  )
}

export default defineConfig({
  testDir: './e2e',
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
  },
  webServer: usesManagedLocalServer
    ? {
        command: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
        env: {
          ...process.env,
          NEXT_PUBLIC_DEV_BYPASS_AUTH: '0',
        },
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
})
```

- [ ] **Step 2: Update smoke assertions**

Replace `frontend/e2e/smoke.spec.ts` with:

```ts
import { test, expect } from '@playwright/test'

test('landing page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /loopcast|стрім|stream/i }).first()).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: /start free|почати безкоштовно|начать бесплатно/i,
    }).first()
  ).toBeVisible()
})

test('login page loads', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
})

test('dashboard redirects to login when unauthenticated', async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1', 'Dev auth bypass enabled')
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})
```

- [ ] **Step 3: Document the e2e auth contract**

Append this paragraph to `docs/TESTING.md` under the Playwright section:

```markdown
Managed Playwright runs force `NEXT_PUBLIC_DEV_BYPASS_AUTH=0` so `/dashboard` redirect tests exercise the real-auth boundary. When using `PLAYWRIGHT_BASE_URL`, start the target server with `NEXT_PUBLIC_DEV_BYPASS_AUTH=0`; the config fails fast if the local environment still advertises bypass mode.
```

- [ ] **Step 4: Verify cold and warm e2e paths**

Run:

```bash
cd frontend
npm run test:e2e
NEXT_PUBLIC_DEV_BYPASS_AUTH=0 npm run dev -- --hostname 127.0.0.1 --port 3000
```

In another shell:

```bash
cd frontend
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 NEXT_PUBLIC_DEV_BYPASS_AUTH=0 npx playwright test --reporter=list --workers=1
```

Expected: both runs pass 5 tests.

- [ ] **Step 5: Commit e2e stabilization**

Run:

```bash
git add frontend/playwright.config.ts frontend/e2e/smoke.spec.ts docs/TESTING.md
git commit -m "test: stabilize Playwright auth smoke"
```

## Task 4: Next Build Lint Integration

**Files:**
- Modify: `frontend/next.config.js`
- Modify: `docs/TESTING.md`

- [ ] **Step 1: Preserve explicit lint and suppress invalid build-time lint**

In `frontend/next.config.js`, add this property inside `nextConfig`:

```js
  eslint: {
    // CI and local verification run `npm run lint` explicitly. Next's build-time
    // lint bridge passes legacy options that are invalid with this flat config.
    ignoreDuringBuilds: true,
  },
```

Place it next to `reactStrictMode`.

- [ ] **Step 2: Document why build lint is disabled**

Append to `docs/TESTING.md`:

```markdown
`next build` does not own linting for this project. The frontend lint gate is `cd frontend && npm run lint`; build-time lint is disabled because Next's lint bridge passes legacy ESLint options that are invalid with the current flat config.
```

- [ ] **Step 3: Verify warning is gone and explicit lint remains green**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: `npm run lint` passes, and `npm run build` no longer prints `ESLint: Invalid Options`.

- [ ] **Step 4: Commit build-lint cleanup**

Run:

```bash
git add frontend/next.config.js docs/TESTING.md
git commit -m "chore: keep frontend lint as explicit gate"
```

## Task 5: Deploy Workflow Quarantine and Ownership Record

**Files:**
- Modify: `.github/workflows/deploy-vps.yml`
- Create: `docs/operations/deployment-status.md`

- [ ] **Step 1: Record the current conflict**

Create `docs/operations/deployment-status.md`:

```markdown
# Deployment Status

Date: 2026-06-06

## Current repository state

`.github/workflows/deploy-vps.yml` exists and currently declares push-to-main, hourly schedule, and manual triggers.

## Operational risk

Earlier operational context said the VPS autodeploy path was obsolete. Because the current checkout still contains the workflow, automatic deploys are quarantined to manual dispatch until production ownership is revalidated.

## Revalidation commands

```bash
gh workflow list
gh run list --workflow "Deploy VPS" --limit 20
gh secret list
```

If the VPS path is current, restore the required automatic triggers in a separate deployment PR with fresh production sign-off. If it is obsolete, delete the workflow and stale deploy scripts in a separate cleanup PR.
```

- [ ] **Step 2: Make Deploy VPS manual-only**

Replace the `on:` block in `.github/workflows/deploy-vps.yml` with:

```yaml
on:
  workflow_dispatch:
```

Leave the job body intact so manual recovery remains possible.

- [ ] **Step 3: Validate workflow YAML**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import yaml
path = Path('.github/workflows/deploy-vps.yml')
with path.open() as handle:
    yaml.safe_load(handle)
print('workflow yaml parses')
PY
```

Expected: prints `workflow yaml parses`.

- [ ] **Step 4: Commit workflow quarantine**

Run:

```bash
git add .github/workflows/deploy-vps.yml docs/operations/deployment-status.md
git commit -m "chore: quarantine VPS deploy automation"
```

## Task 6: Proxy CSP Alignment

**Files:**
- Modify: `docker/Caddyfile.template`
- Modify: `docker/Caddyfile`

- [ ] **Step 1: Replace Caddy CSP in the template**

In both header blocks of `docker/Caddyfile.template`, replace the current `Content-Security-Policy` line with:

```caddyfile
        Content-Security-Policy "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https://*.supabase.co https://i.ytimg.com https://yt3.ggpht.com; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co wss:; media-src 'self' blob:; frame-src 'self'; object-src 'none'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests"
```

This removes proxy-level `unsafe-eval`, removes broad `img-src https:`, and adds directives already present in `frontend/next.config.js`.

- [ ] **Step 2: Regenerate `docker/Caddyfile`**

Run:

```bash
python3 scripts/render_caddyfile.py --variant docker --template docker/Caddyfile.template --output docker/Caddyfile
```

- [ ] **Step 3: Verify generated file stays in sync**

Run:

```bash
python3 scripts/render_caddyfile.py --variant docker --template docker/Caddyfile.template --output /tmp/docker.Caddyfile
diff -u docker/Caddyfile /tmp/docker.Caddyfile
```

Expected: no diff.

- [ ] **Step 4: Commit CSP alignment**

Run:

```bash
git add docker/Caddyfile.template docker/Caddyfile
git commit -m "fix: align proxy CSP with frontend policy"
```

## Task 7: React Doctor High-confidence Fixes

**Files:**
- Modify: `frontend/src/app/dashboard/streaming/page.tsx`
- Modify: `frontend/src/app/dashboard/library/page.tsx`
- Modify: `frontend/src/components/upload/UploadModal.tsx`
- Modify: `frontend/src/app/dashboard/streaming/components/StreamPreviewPanel.tsx`
- Modify: `frontend/src/components/layout/Topbar.tsx`
- Modify: `frontend/src/components/ui/CommandPalette.tsx`

- [ ] **Step 1: Capture baseline React Doctor score**

Run:

```bash
cd frontend
npx -y react-doctor@latest . --verbose --score
```

Expected: current score around `52`.

- [ ] **Step 2: Fix iframe sandbox warning**

In `frontend/src/app/dashboard/streaming/components/StreamPreviewPanel.tsx`, add a sandbox attribute to the preview iframe:

```tsx
sandbox="allow-scripts allow-same-origin allow-presentation"
```

Run the relevant component tests or `cd frontend && npm test -- StreamPreviewPanel`.

- [ ] **Step 3: Fix `useSearchParams` usage**

Move the body of `StreamingPage` into a child component and wrap it in Suspense:

```tsx
import { Suspense } from 'react'

export default function StreamingPage() {
  return (
    <Suspense fallback={null}>
      <StreamingPageContent />
    </Suspense>
  )
}

function StreamingPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // existing body continues here
}
```

Preserve the existing `useEffect` that handles `?new=1`, then run `cd frontend && npm run build`.

- [ ] **Step 4: Fix top accessibility issues**

For each element reported by React Doctor as an interactive non-focusable element, replace the wrapper with a native `button` when it triggers an action. For `frontend/src/components/layout/Topbar.tsx`, use this pattern:

```tsx
<button
  type="button"
  aria-label={label}
  onClick={handler}
  className={existingClassName}
>
  {children}
</button>
```

Run:

```bash
cd frontend
npm run lint
CI=1 npm test
```

- [ ] **Step 5: Split only the largest stateful files after bug fixes**

Extract hooks/components in this order:
- `frontend/src/app/dashboard/library/page.tsx`: move selection and modal orchestration into `frontend/src/app/dashboard/library/hooks/useLibraryPageState.ts`.
- `frontend/src/components/upload/UploadModal.tsx`: move upload item reducer into `frontend/src/components/upload/useUploadModalState.ts`.
- `frontend/src/app/dashboard/streaming/page.tsx`: move query orchestration into `frontend/src/app/dashboard/streaming/hooks/useStreamingPageController.ts`.

Use `useReducer` for grouped state where React Doctor reports many related `useState` calls.

- [ ] **Step 6: Verify React Doctor improves without regressions**

Run:

```bash
cd frontend
npx -y react-doctor@latest . --verbose --score
npm run lint
npm run type-check
CI=1 npm test
npm run build
NEXT_PUBLIC_DEV_BYPASS_AUTH=0 npm run test:e2e
```

Expected: React Doctor score increases, no test/build regressions.

- [ ] **Step 7: Commit frontend correctness/accessibility fixes**

Run:

```bash
git add frontend/src
git commit -m "fix: address high-confidence React Doctor findings"
```

## Task 8: Pre-commit and CI Drift

**Files:**
- Modify: `.pre-commit-config.yaml`
- Modify: `.github/workflows/frontend-quality.yml`
- Modify: `.github/workflows/backend-quality.yml`

- [ ] **Step 1: Align frontend pre-commit versions**

In `.pre-commit-config.yaml`, update the ESLint hook additional dependencies to match the project:

```yaml
        additional_dependencies:
          - eslint@8.57.1
          - eslint-config-next@15.5.15
          - '@typescript-eslint/parser@8.59.0'
          - '@typescript-eslint/eslint-plugin@8.59.0'
```

Also set:

```yaml
  node: 24.0.0
```

- [ ] **Step 2: Add frontend audit gate to CI**

In `.github/workflows/frontend-quality.yml`, add after `Install dependencies`:

```yaml
      - name: Audit production dependencies
        run: npm audit --omit=dev
```

- [ ] **Step 3: Add backend audit gate to CI**

In `.github/workflows/backend-quality.yml`, add after `Install dependencies`:

```yaml
      - name: Audit Python dependencies
        run: |
          python -m pip install pip-audit
          pip-audit
```

- [ ] **Step 4: Verify local hooks and CI commands**

Run:

```bash
pre-commit run --all-files
cd frontend && npm audit --omit=dev
cd backend && .venv/bin/pip-audit
```

Expected: all pass after Task 1.

- [ ] **Step 5: Commit CI drift fixes**

Run:

```bash
git add .pre-commit-config.yaml .github/workflows/frontend-quality.yml .github/workflows/backend-quality.yml
git commit -m "ci: align quality gates with audited dependencies"
```

## Task 9: Formal Repository Security Scan

**Files:**
- Create under the Codex Security scan artifact directory selected by the security-scan skill.
- Update: `docs/operations/security-audit-followup.md`

- [ ] **Step 1: Start formal scan with subagents**

Use `codex-security:security-scan` for the whole repository. The workflow requires explicit subagent authorization before exhaustive scoped/repository discovery.

- [ ] **Step 2: Complete required phases**

Run the phases in order:
1. Threat model.
2. Finding discovery.
3. Validation.
4. Attack-path analysis.
5. Final markdown and HTML reports.

- [ ] **Step 3: Persist summary**

Append a short summary to `docs/operations/security-audit-followup.md` using the generated scan directory:

```bash
scan_dir="$(find . -path '*security*scan*' -type d -print | sort | tail -n 1)"
reportable_count="$(rg -n 'reportable|Reportable' "$scan_dir" 2>/dev/null | wc -l | tr -d ' ')"
deferred_count="$(rg -n 'deferred|Deferred' "$scan_dir" 2>/dev/null | wc -l | tr -d ' ')"
if rg -n 'critical|high|production-blocking|Production-blocking' "$scan_dir" >/dev/null 2>&1; then
  production_blocking="review-required"
else
  production_blocking="none-found-in-summary-text"
fi

cat >> docs/operations/security-audit-followup.md <<EOF

## Formal Codex Security Scan

- Scan directory: ${scan_dir}
- Reportable text hits: ${reportable_count}
- Deferred text hits: ${deferred_count}
- Production-blocking summary state: ${production_blocking}
EOF
```

Open the final markdown report from `${scan_dir}` and replace `production_blocking` with `none`, `yes`, or `review-required` based on the validated findings before committing.

- [ ] **Step 4: Commit security scan follow-up**

Run:

```bash
git add docs/operations/security-audit-followup.md
git commit -m "docs: record formal security scan follow-up"
```

## Final Verification

Run the strictest path available on the machine:

```bash
RUN_BLACK=1 make lint-backend
cd backend && .venv/bin/python -m mypy --config-file mypy.ini
cd ../frontend && npm run lint && npm run type-check && npm run i18n:check
cd ..
make test-backend-localdb
cd frontend && CI=1 npm test && npm run build && NEXT_PUBLIC_DEV_BYPASS_AUTH=0 npm run test:e2e
cd ../backend && .venv/bin/pip-audit
cd ../frontend && npm audit --omit=dev
```

When local ports are free for Compose-owned services, also run:

```bash
make verify-v0
```

Expected: all commands pass. If `make verify-v0` is blocked by host-owned Postgres/Redis, record that blocker and the successful `verify-v0-localdb` or equivalent command set in the PR body.
