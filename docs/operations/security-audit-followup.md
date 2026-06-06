# Security Audit Follow-up

Date: 2026-06-06

## Package Advisories

- Backend: resolved through `backend/requirements.txt` pin updates and `.venv` reinstall.
- Frontend production dependencies: resolved through `npm audit fix --omit=dev` plus a `postcss` override required by Next's pinned nested dependency.

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
