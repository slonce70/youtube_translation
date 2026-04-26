# 2026-04-25 — Prod recovery: `_apply_schema_changes` was silently dropping migration 037's columns on every backend boot

> **Initial diagnosis (PRs #50–#57) was wrong.** The malformed `DATABASE_URL` in `.env` was a real but secondary issue — the *primary* root cause was a stale `DROP COLUMN` block in `app/core/database.py::_apply_schema_changes` that ran on every backend startup and removed the very columns migration 037 had just added. SSH verification on 2026-04-26 found the column gone *after* the migration log claimed success, even after PR #57's `.env` self-heal landed cleanly. Real fix: PR #59 (this runbook's accompanying patch) removes the two columns from the legacy DROP list.

## TL;DR
Sprint 8 merges (PRs #47–49) introduced no app-behavior bugs, but each subsequent push from 22:17 UTC onward triggered a Deploy VPS failure that misled the chase across **eight follow-up PRs (#50–#57)**. The actual root cause was a **malformed `DATABASE_URL` line in `/opt/youtube_translation/backend/.env` on the production VPS**:

```
DATABASE_URL=postgresql://youtube_user:***/youtube_streaming
```

Note the missing `@host:port` segment. The deploy workflow exports a shell-injected `DATABASE_URL` env var that overrides this for the migration step (so `apply_migrations.py` connects fine and persists DDL), but the host-native systemd backend loads `.env` via `EnvironmentFile=` (no shell expansion, no inherited shell env), gets the broken literal, and asyncpg then dials a hostless URL — yielding a `UndefinedColumnError` for `streams.runtime_restart_attempts` despite the column having actually landed in the docker postgres.

## Timeline (commits, all on `main`)

| PR | Hypothesis tested | Outcome |
|---|---|---|
| #50 | "Migration runner's `await conn.commit()` inside `engine.begin()` is rolling back the DDL" | Removed the explicit commit; deploy still failed |
| #51 | "AUTOCOMMIT mode on the migration runner is more bulletproof" | Switched to AUTOCOMMIT; deploy still failed |
| #52 | "Add a cross-connection probe so we can tell *whether* DDL persists across connections" | Probe **passed** — DDL was definitely persisting |
| #53 | "Migrator and backend hit different Postgres instances; route the DDL through `docker exec` so it lands in the canonical container" | Container DB confirmed as correct; backend still crashed |
| #54 | "Forensic dump of `.env` DB-related lines, listening sockets, port mapping, ` runtime_*` columns" | Container + host:5432 both showed the column present |
| #55 | "Unmask the `DATABASE_URL` host:port in the forensic so we can finally see *where* backend is dialling" | **Found it** — `.env` literal had no `@host` |
| #56 | "Append a healthy `DATABASE_URL` line and trust last-wins" | Heal fired; backend still crashed (last-wins didn't actually win on this systemd version) |
| #57 | "Strip every `DATABASE_URL` line and append exactly one fresh authoritative line; URL-encode password" | **Deploy green; prod backend boots cleanly** |

## Root cause analysis

The `.env` file on the production VPS predates the audit work. At some point an operator either:
1. Hand-edited the `DATABASE_URL` value and accidentally deleted the `@host:port` substring while masking the password; or
2. Pasted a template line that was never meant to be the active value.

The migration runner masked the symptom for months because GitHub Actions injects `DATABASE_URL` into the SSH-spawned shell environment — overriding `.env`. The host-native systemd unit, which only reads `EnvironmentFile=`, did not benefit from that override. So:

- **What worked the whole time**: GitHub-Actions-driven migrations (host shell env wins)
- **What was broken the whole time**: the `youtube-backend.service` systemd unit (only the `.env` file is consulted)

The bug surfaced visibly the moment Sprint 2's H5 added a new column (`runtime_restart_attempts`) referenced unconditionally in the model's `select(Stream).where(...)` query at startup. Before that column existed, the backend would *also* boot from this misconfigured `.env` — but its queries didn't reference any column the wrong DB was missing, so the connection silently succeeded against whatever Postgres asyncpg's no-host fallback resolved to.

## Mitigation in place (`scripts/deploy_vps.sh` after PR #57)

On every deploy, immediately after the migration step + docker-exec safety net + forensic dump, the script:

1. Reads `DATABASE_URL` from `backend/.env`.
2. If the value lacks `@`, treats it as malformed.
3. Reads `POSTGRES_PASSWORD` from the same `.env` and URL-encodes it.
4. Strips **every** `DATABASE_URL=` line from `.env`.
5. Appends exactly one fresh line:
   `DATABASE_URL=postgresql://youtube_user:<encoded-password>@127.0.0.1:5432/youtube_streaming`
6. Echoes a sanitized confirmation so the deploy log shows what landed.

This is an **idempotent self-heal**. On a healthy `.env`, the condition fails and nothing changes.

## Operator follow-ups (recommended)

1. **SSH into the VPS** and verify `cat /opt/youtube_translation/backend/.env | grep DATABASE_URL` shows exactly one line with `@127.0.0.1:5432`.
2. **Audit `.env` history** if the host has any backup mechanism — figure out *when* and *who* introduced the malformed line so it can't happen again.
3. **Consider moving the systemd unit to read `DATABASE_URL` from a different mechanism** (e.g. injected via `Environment=` in a drop-in override file managed by deploy, or via `systemd-credentials`). The current state — an EnvironmentFile that only matters when the deploy script doesn't double-override — is fragile by design.
4. **Add a `validate_database_url` rejection for hostless URLs** in `app/core/config.py`: the current implementation explicitly returns `v` when `parsed.hostname` is empty (line 222), which lets a misconfiguration silently pass. Failing fast at `Settings()` instantiation would have caught this in seconds instead of after an eight-PR chase.
5. **Document `POSTGRES_PASSWORD` location** so future operators know where the canonical secret lives and avoid re-creating templated `.env` files with placeholder values.

## What did NOT cause it (refuted hypotheses)

- ❌ SQLAlchemy's `engine.begin()` + explicit `commit()` toggle did not rollback the migration (PR #50)
- ❌ AUTOCOMMIT mode was not required for migration persistence (PR #51 — DDL persisted in both modes)
- ❌ Migrator and backend were not connecting to *different* postgres binaries on disk; they were both connecting to (different parsed views of) the same `localhost:5432` mapping
- ❌ The docker postgres container's port mapping was correct (`127.0.0.1:5432 → 5432/tcp`) and migration 037's columns landed in it on every deploy
- ❌ Migration 036 dropping the column was not racing migration 037 adding it back

## Related commits

- `2170dd2` — PR #56 (append-only heal, didn't take effect)
- `8cbfa62` (squash of `4538d7c`) — PR #57 (deterministic replace + URL-encode, **fixed prod**)

---

**Postmortem author:** Claude Opus 4.7 (autonomous remediation under user direction).
**Total iterations to root cause:** 8 PRs (#50–#57). Diagnostic forensic was the breakthrough; should have been step 2, not step 6.
