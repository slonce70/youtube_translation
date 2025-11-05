# Localization Implementation Plan

## Strategy Decisions
- Adopt `next-intl` for App Router compatibility, server/client hooks, and middleware support.
- Keep URLs language-agnostic (`localePrefix: 'never'`) to match competitor UX, simplify shared links, and avoid clashes with existing auth middleware; rely on detection + cookie for SSR/CSR parity.
- Default locale: `uk`; additional locales: `ru`, `en`. Persist last choice in `NEXT_LOCALE` cookie and expose manual language switcher in navigation.
- Extend font configuration to include Cyrillic (e.g., `Inter` subsets `['latin', 'cyrillic']`) to preserve visual consistency across languages.
- Centralize formatting (dates, numbers, durations) via locale-aware utilities that read from `Intl` using the active locale.

## Phase 0 — Discovery & Prep
0.1 Audit all user-facing text across `frontend/src/app`, `frontend/src/components`, `frontend/src/lib`, and toast/error messages from Supabase/API.  
0.2 Categorize strings into domains (`common`, `nav`, `auth`, `dashboard`, `streaming`, `admin`, `errors`). Note contextual nuances and maximum lengths for responsive layouts.  
0.3 Inventory dynamic strings requiring interpolation or plural logic (e.g., quotas, hours, asset counts).  
0.4 Confirm with stakeholders the preferred tone/terminology per language and gather glossary if available.

## Phase 1 — Dependencies & Configuration Scaffold ✅
1.1 Add `next-intl@^3` (or latest compatible with Next 15) to `package.json`; install without altering other lockfile entries.  
1.2 Create `frontend/src/i18n/config.ts` exporting `locales`, `defaultLocale`, `localePrefix: 'never'`, and helper types.  
1.3 Add `frontend/src/i18n/request.ts` (wrapper around `next-intl/server` helpers: `getLocale`, `getMessages`, `getTranslations`).  
1.4 Wrap existing `next.config.js` with `const withNextIntl = require('next-intl/plugin')('./i18n.ts')` while preserving custom webpack settings; ensure tree-shaking unaffected.  
1.5 Update `frontend/i18n.ts` to load namespaced message bundles (`./src/messages/{locale}/*.json`) instead of flat file, and expose strongly typed request config.

## Phase 2 — Application Shell Integration ✅
2.1 Restructure `frontend/src/app/layout.tsx` into server component that reads locale via `getLocale` and passes to a new `RootProviders`.  
2.2 Introduce `frontend/src/app/[lang]/` segment **without** changing public URLs by leveraging middleware rewrite (Phase 3); ensure layout still renders at `/`.  
2.3 Replace plain `<html lang="en">` with `<html lang={locale}>`; load `Inter` font with Cyrillic subsets and pass className to `<body>`.  
2.4 Create `frontend/src/app/[lang]/(with-auth)/layout.tsx` if needed to share context between authenticated routes while receiving locale from parent.

## Phase 3 — Middleware & Routing Logic ✅
3.1 Configure `frontend/src/middleware.ts` using `createMiddleware` from `next-intl/middleware` with locales list, default locale, and cookie fallback.  
3.2 Merge existing Supabase auth checks into the same middleware, ensuring redirects append preserved search params and respect resolved locale.  
3.3 Add root redirect `/` → default locale by setting `locale: false` and manually rewriting response if no cookie is present (while keeping visible URL unchanged).  
3.4 Validate that static assets, API routes, and Next internals remain excluded from locale handling.

## Phase 4 — Message Catalog Structure ✅
4.1 Establish directory `frontend/src/messages/{uk,en,ru}/` with base files (`common.json`, `nav.json`, `auth.json`, `dashboard.json`, `streaming.json`, `admin.json`, `errors.json`).  
4.2 Seed Ukrainian messages first (source of truth). For English/Russian create placeholder copies for translation.  
4.3 Add TypeScript helper (`frontend/src/i18n/messages.ts`) generating `Messages` type and augment `next-intl` module for typed keys.  
4.4 Document naming convention (`section.keyName`, kebab-case or camelCase) to ensure consistency.

## Phase 5 — Providers & Utilities ✅
5.1 Implement `frontend/src/i18n/I18nProvider.tsx` that wraps `NextIntlClientProvider`, loads messages via `getMessages`, and nests existing `Providers` (React Query) inside.  
5.2 Add custom hook `useLocale()` / `useScopedI18n()` for client components and `getScopedI18n()` for server components to avoid repetitive namespace strings.  
5.3 Refactor formatting utilities (`formatBytes`, `formatHoursHuman`, date helpers) to accept locale argument or read from `useLocale`. Ensure memoization to avoid re-computation.

## Phase 6 — UI Refactor (Per Module) ⚙️ In progress
6.1 ✅ Navigation (desktop/mobile, profile dropdown)
6.2 ✅ Authentication flow (/login)
6.3 ✅ Dashboard core widgets (stats block, usage overview, checklist)
6.4 ⚙️ Shared components (Subscription banner, PlanLimitsCard, QuickActions, Stream controls) — ✅
    • Dashboard library toasts localized (`library.toasts`) ✅
6.5 ⚙️ Streaming & library operations — ✅
    • Localize streaming dashboard toasts (`streaming.toasts`, status labels) ✅
    • Localize profile notifications & forms (`profile.*`) ✅
    • Localize admin consoles (users, alerts, streams) ✅
6.6 ✅ Supabase error mapping (central translator + locale messages)
6.7 ⚙️ Language switcher & persistence — ✅
    • Add navbar language selector with cookie persistence ✅
    • Expose selector on auth screens ✅
    • Persist locale via middleware (cookie-driven) ✅

## Phase 8 — Metadata & SEO
8.1 ✅ Localize root metadata via `generateMetadata`
8.2 ✅ Add route-specific metadata (dashboard, admin)
8.3 ✅ Ensure structured data snippets (if any) use locale-aware values.
6.1 Navigation (`NavBar`, mobile menu, profile dropdown, CTA buttons) → replace label literals with `t('nav:dashboard')` etc.; ensure `aria-label` and tooltip strings translated.  
6.2 Authentication flow (`/login`, forgot password if present) → translate headings, form labels, validation/errors, CTA toggles, success states.  
6.3 Dashboard & child pages → convert hero texts, stats, tooltips, checklist items, table headers, quick actions, banners. Handle dynamic values via interpolation/plural rules.  
6.4 Shared components (`Toaster`, `LoadingState`, `PlanLimitsCard`, `StreamControlWidget`, `SubscriptionBanner`, modals) → wrap strings; pass translations via props when components are deeply nested.  
6.5 Admin area (`/admin/*`) → audit and translate tables, filters, status badges, empty state messages. ✅  
6.6 Replace hard-coded Supabase error handling with mapping function (`mapAuthErrorToKey`) to show localized toasts. ✅

## Phase 7 — Language Switcher & Persistence
7.1 Build `LanguageSwitcher` component (likely inside `NavBar` near `DarkModeToggle`) that lists `uk`, `ru`, `en`.  
7.2 On selection, call `setLocale` from `next-intl` (client navigation) so the URL stays the same but content reloads; ensure SSR hydration by writing `NEXT_LOCALE` cookie.  
7.3 For unauthenticated pages (login), render switcher in a consistent location (e.g., top-right).  
7.4 Handle initial detection: inspect `Accept-Language`, then fallback to cookie; expose an opt-out for locale auto-detection if required.

## Phase 8 — Metadata & SEO
8.1 Convert static `metadata` exports to dynamic `generateMetadata` using `getTranslations` to supply localized `title`, `description`, and `openGraph`.  
8.2 Update `next-sitemap` (if present) or manual sitemap generation to include `alternateLanguage` entries.  
8.3 Ensure structured data snippets (if any) use locale-aware values.

## Phase 9 — Quality Assurance
9.1 ✅ Add ESLint rule (`i18next/no-literal-string`) scoped to `src/app` & `src/components` with allowlist for technical tokens (IDs, acronyms).
9.2 ✅ Write Jest/RTL smoke tests to confirm `useTranslations` renders expected text for each locale (mocking provider).
9.3 ✅ Create Cypress/Playwright plan (if available) for regression: switch language, verify persistence after login/logout.
9.4 ✅ Manual QA checklist: go through critical flows in all three languages, verify layout integrity, responsive states, and fallback behavior when translations missing.

## Phase 10 — Localization Workflow
10.1 ✅ Draft contributor guide section (in `frontend/README.md` or `docs/localization.md`) covering how to add/update translation keys and run validation.  
10.2 ✅ Implement script `npm run i18n:check` to detect missing/unused keys (e.g., with `next-intl/plugin` utilities or custom TypeScript script).  
10.3 ✅ Set up CI step to run lint + `i18n:check` so untranslated literals fail fast.  
10.4 ✅ Establish process with translators (source JSON export, translation tool integration, review loop) and tie into PR checklist.

## Phase 11 — Rollout
11.1 ✅ Populate English/Russian translations (human translators or interim machine seed + review).  
11.2 ✅ Validate production build (`npm run build`) with all locales; monitor bundle size impact from JSON messages.  
11.3 ✅ Prepare release notes outlining new language support and instructions for users.  
11.4 ✅ Post-launch monitoring: watch Supabase logs & analytics for locale adoption, collect feedback for iterative polish.

## Progress Log
- 2025-11-05: Localized structured data snippets for root/dashboard/admin pages, ensured ESLint i18n rule coverage, added localization QA checklist, translated admin/dashboard/streaming/plans interfaces, and authored `docs/localization.md` contributor guidance. Remaining focus: Phase 11 rollout tasks.  
- 2025-11-05: Implemented `npm run i18n:check`, added GitHub workflow to enforce lint + localization parity, updated translator handoff guidelines, and corrected English auth bundle JSON syntax.  
- 2025-11-05: Finalized English/Russian bundles, localized upload & quota widgets, wired release notes, documented monitoring plan, and validated production build with localization enabled.
