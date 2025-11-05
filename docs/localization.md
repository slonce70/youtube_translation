# Localization Contributor Guide

## Overview

This document explains how to add or update UI translations for the Next.js frontend.

- Message bundles live under `frontend/src/messages/{locale}/`.
- Keys are namespaced by feature (`common`, `nav`, `dashboard`, `streaming`, etc.).
- Type safety is enforced through `next-intl` and the generated `Messages` type.

## Adding Strings

1. Introduce new keys in the Ukrainian bundle first (source locale).
2. Mirror the same keys in the Russian and English bundles.
3. Keep JSON sorted alphabetically within each namespace for readability.
4. Run `npm run lint` to ensure the i18n ESLint rule passes without literal strings.
5. Update any related server-side metadata translations (see `frontend/src/app/metadata.ts`).

## Validating Changes

- Run `npm run i18n:check` to ensure every locale stays in sync with the Ukrainian source bundle.
- Use `npm run test` to confirm localization smoke tests still pass.
- Launch the app (`npm run dev`) and verify the feature in all supported locales via the language switcher.
- Consult `docs/LOCALIZATION_QA.md` for the full manual QA matrix.

## Translator Handoff Process

1. Run `npm run i18n:check` and fix any reported gaps before exporting strings for translators.
2. Export the relevant `frontend/src/messages/{locale}/*.json` namespaces (typically as a zip archive or via your translation platform of choice).
3. Provide translators with context: feature screenshots, glossary entries, and notes about character limits when applicable.
4. When translations return, replace the locale JSON files and run `npm run i18n:check` again to spot missing or extra keys.
5. Perform a quick in-app review (`npm run dev`) in each locale to confirm tone and spacing still look correct.
6. Record translation sources/approvals in the PR description so reviewers know what was machine translated versus human reviewed.

## Submitting Changes

- Reference the updated keys in PR descriptions.
- Include screenshots for UI-heavy updates in each locale.
- Mention any new JSON files or namespaces so reviewers can focus translation checks.
- Add checklist items for `npm run lint` and `npm run i18n:check` in the PR so reviewers can verify both were executed.
