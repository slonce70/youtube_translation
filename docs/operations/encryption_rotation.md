# Encryption Key Rotation

Provider secrets (YouTube stream keys, OAuth tokens) are encrypted with
`MultiFernet`. Rotation is a 3-phase procedure built on top of
[`backend/scripts/rotate_encryption_keys.py`](../../backend/scripts/rotate_encryption_keys.py),
which is idempotent and safe to re-run.

## When to rotate

- Suspected key leak (developer laptop loss, secret accidentally committed, etc.)
- Scheduled rotation (recommended quarterly)
- Personnel change with access to production secrets

## Prerequisites

- New 32-byte URL-safe Fernet key generated:
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- Access to the production `backend/.env` (and `.env` if `ENCRYPTION_KEY*` is duplicated there)
- A short maintenance window. Live streams keep running; only fresh writes need the new primary
  to be active before they land.

## Phase 1 — Add new key as primary, keep old as previous

Edit `backend/.env`:

```
ENCRYPTION_KEY=<new-key>
ENCRYPTION_KEY_PREVIOUS=<old-key>     # was the only ENCRYPTION_KEY before
```

Restart the backend so `Settings()` re-reads the env:

```bash
# Docker compose path
docker compose -f docker/docker-compose.yml restart backend

# Host-native systemd path
sudo systemctl restart youtube-backend
```

Verify the backend boots and logs show the previous key wired up:

```
stream-key encryption initialized with 1 previous key(s) for rotation
```

At this point: writes use the **new** key; reads transparently fall back to the **old** key
for any ciphertext written before this restart.

## Phase 2 — Re-encrypt every record under the new primary

Dry-run first to confirm the row counts look right:

```bash
cd backend
.venv/bin/python -m scripts.rotate_encryption_keys --dry-run
```

You should see one summary line per encrypted column (destinations, youtube_connections).
`rewritten` is the number of records that would be re-encrypted; `errors` must be 0.

Now run for real:

```bash
.venv/bin/python -m scripts.rotate_encryption_keys
```

If `errors > 0`, that table was rolled back. Investigate, fix, re-run — the script is
idempotent and skips rows already under the primary key (`MultiFernet.rotate` is a no-op
in that case).

## Phase 3 — Drop the old key

After Phase 2 completes with `errors=0`, no ciphertext remains under the old key.

Edit `backend/.env`:

```
ENCRYPTION_KEY=<new-key>
# ENCRYPTION_KEY_PREVIOUS=  ← remove or leave blank
```

Restart the backend one last time. Verify the previous-key log line is gone.

If you want belt-and-braces confirmation that no record still needs the old key, run the
rotation in dry-run mode again — it should report `rewritten=0` across the board.

## Rollback

If anything goes wrong before Phase 3:

1. Restore the old `ENCRYPTION_KEY=<old-key>` in `.env`, drop `ENCRYPTION_KEY_PREVIOUS`.
2. Restart the backend.
3. Records re-encrypted under the new key in Phase 2 cannot be read with only the old key —
   so if Phase 2 partially completed, you must keep both keys until Phase 2 finishes
   successfully under the original key configuration.

The safe rollback window is **before Phase 2 has written anything**. Run Phase 2 with
`--dry-run` and confirm row counts before doing it for real.

## Operational notes

- The script targets these columns:
  - `destinations.stream_key_encrypted`
  - `youtube_connections.access_token_encrypted`
  - `youtube_connections.refresh_token_encrypted`
- Each table is rotated in its own transaction; partial failure on one table does not
  roll back earlier tables.
- Re-running the script after a crash is safe (idempotent).
- The salt (`ENCRYPTION_SALT`) is used to derive Fernet keys from the env values; rotate
  the salt only with great care — every prior key reference becomes unreadable.
