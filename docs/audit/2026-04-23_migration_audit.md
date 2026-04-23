# Phase 2.4 — Correction: Migration system audit

## Summary

The original [remediation plan](2026-04-23_remediation_plan.md) Phase 2.4
called for "consolidating Alembic + `apply_migrations.py`" into a single
migration owner. **This turns out to be based on a faulty premise**: the
project does not use Alembic at all. There is a single, well-defined
migration system already in place.

## Actual state

- **Migration definitions:** raw SQL files under `backend/migrations/`,
  numerically ordered (000 → 036 as of this audit).
- **Migration runner:** `backend/apply_migrations.py` (1 434 lines)
  applies files in an explicit hard-coded order and records the set of
  applied migrations in a tracking table.
- **Boot-time safety net:** `app/core/database.py::_apply_schema_changes`
  performs idempotent `CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
  EXISTS` patches for a handful of schemas. These are covered by an
  advisory lock (`SCHEMA_PATCH_LOCK_ID=872634`) and are gated by
  `RUN_SCHEMA_PATCHES_ON_BOOT` since the April 2026 remediation pass.

There is **no `alembic.ini`, no `alembic/` tree, no `env.py`**. A search
for `alembic` across `backend/` returns no hits, and `backend/requirements.txt`
does not depend on `alembic`.

## Where `apply_migrations.py` is referenced

- `backend/entrypoint.sh` — Docker container entrypoint runs the runner
  on startup.
- `scripts/deploy_vps.sh:541` — production deploy script invokes it.
- `backend/tests/test_deploy_vps_script.py:375` — test asserts the
  deploy script still calls it.
- `docs/DATABASE_MIGRATIONS_LOCAL.md` and `README.md` — operator docs.
- `backend/AGENTS.md` — agent onboarding note.

All of these expect a single owner. Nothing would be improved by
introducing Alembic on top.

## What Phase 2.4 actually needs

Nothing structural. Three smaller cleanups that the audit conflated
into "consolidate Alembic":

1. **Completed in this remediation pass:** the one-shot helpers
   `backend/apply_migration_007.py` and
   `backend/apply_migration_007_direct.py` were leftover from before
   `007_remove_projects.sql` landed; both were removed in commit
   `8427206`.
2. **Completed in this remediation pass:** the boot-time
   `apply_schema_patches()` call in `app/main.py` is now gated by
   `RUN_SCHEMA_PATCHES_ON_BOOT` (default `true` to preserve behaviour),
   so deployments that run `apply_migrations.py` out-of-band can
   disable the extra on-boot DDL pass.
3. **Not required, optional:** if the team later wants to migrate
   raw-SQL → Alembic for versioned up/down support and auto-generated
   migrations, that is a separate multi-day project with its own RFC.
   Do not attempt it as a drive-by during audit remediation.

## Recommendation

Close Phase 2.4 as "no action required beyond what was already done".
Keep raw-SQL migrations + `apply_migrations.py` as the single source
of truth until a broader decision is made about schema tooling.

Any future audit pass that flags this setup as "dual migration system"
should double-check by searching for `alembic` in `backend/requirements.txt`
and by running `find backend -name alembic.ini`.
