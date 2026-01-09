# AGENTS.md (frontend/)

## Package Identity
- Next.js (App Router) web UI for the platform: dashboards, admin, uploads, and streaming control.
- Tech: TypeScript, Tailwind, React Query, next-intl i18n, Supabase Auth client.

## Setup & Run
- Install deps: `make install-frontend` (or `cd frontend && npm install`)
- Dev server: `make dev-frontend` (or `cd frontend && npm run dev`)
- Build: `cd frontend && npm run build`
- Lint: `cd frontend && npm run lint`
- Typecheck: `cd frontend && npm run type-check`
- Unit tests: `cd frontend && npm test`
- E2E tests: `cd frontend && npm run test:e2e`
- i18n consistency: `cd frontend && npm run i18n:check`

## Patterns & Conventions (most important)
- **Routes/pages** use App Router under `frontend/src/app/**`:
  - Dashboard: `frontend/src/app/dashboard/page.tsx`
  - Admin: `frontend/src/app/admin/page.tsx`
  - API route example: `frontend/src/app/api/health/route.ts`
- **Providers**: React Query setup lives in `frontend/src/app/providers.tsx`.
- **UI components**:
  - Reusable primitives: `frontend/src/components/ui/*` (example: `frontend/src/components/ui/Button.tsx`)
  - Feature components: `frontend/src/components/**` (example: `frontend/src/components/StreamControlWidget.tsx`)
- **API client**: use the wrapper in `frontend/src/lib/api.ts` (don’t scatter ad-hoc request code).
- **Auth**: Supabase client helpers live in `frontend/src/lib/supabase.ts` and `frontend/src/lib/supabase/server.ts`.
- **i18n messages** live in `frontend/src/messages/{en,ru,uk}/*.json`; keep them in sync with `frontend/scripts/check-i18n.js`.

Examples:
- ✅ DO: wire new backend calls through `frontend/src/lib/api.ts` and consume via React Query (see `frontend/src/app/dashboard/page.tsx`).
- ✅ DO: add new UI primitives under `frontend/src/components/ui/` (see `frontend/src/components/ui/Input.tsx`).
- ❌ DON'T: commit build/test artifacts like `frontend/tsconfig.tsbuildinfo` or `frontend/test-results/`.

## Touch Points / Key Files
- App shell: `frontend/src/app/layout.tsx`, styling: `frontend/src/app/globals.css`
- Request middleware: `frontend/src/middleware.ts`
- API wrapper: `frontend/src/lib/api.ts`
- Supabase config: `frontend/src/lib/supabase/config.ts`, server helpers: `frontend/src/lib/supabase/server.ts`
- Dashboard streaming area: `frontend/src/app/dashboard/streaming/page.tsx`

## JIT Index Hints
- Find a page: `rg -n "export default function" frontend/src/app`
- Find a component: `rg -n "export (function|const)" frontend/src/components`
- Find React Query calls: `rg -n "useQuery\b|useMutation\b" frontend/src`
- Find i18n keys usage: `rg -n "useTranslations\(" frontend/src`
- Find tests: `find frontend/src -name "*.test.ts" -o -name "*.test.tsx"`

## Common Gotchas
- `NEXT_PUBLIC_API_URL` falls back to `http://localhost:8000/api` (see `frontend/src/lib/api.ts`).
- Keep message namespaces aligned across locales; run `npm run i18n:check` after editing `frontend/src/messages/**`.

## Pre-PR Checks
- `cd frontend && npm run lint && npm run type-check && npm test`
