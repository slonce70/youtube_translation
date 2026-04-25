# Runbook — Stream runtime rollback

How to revert a Sprint-2 streaming-runtime change (or any later runtime
modification) without interrupting live RTMPS streams more than the
ffmpeg `-recovery_wait_time` window can absorb.

## Architecture recap

Production runs streams via `STREAM_RUNTIME_MODE=systemd`:

```
youtube-backend.service          ffmpeg@<stream-id>.service
(orchestrator, manages           (one per active stream;
 stream lifecycle in DB)         ffmpeg child process)
        │                                  │
        └─── DB writes / heartbeats ───────┘
```

The backend is the **control plane**. ffmpeg children are **independent
processes** — restarting the backend does NOT kill them in systemd-mode.
This is what makes Sprint-2's hardening (`setsid`, `PR_SET_PDEATHSIG`,
restart-counter persistence) operationally safe to deploy under live
load: the children survive a parent restart.

In Compose / dev mode (`STREAM_RUNTIME_MODE=manager`), ffmpeg children
ARE under the backend's process tree. A backend restart kills them. Do
not run live production traffic in manager mode.

## When to roll back

Triggers:

- `BackendRestartLoop` Prometheus alert (more than 3 restarts in 10 min).
- Stream count drops to zero unexpectedly after a deploy.
- Operator reports "all my streams went dark right after that deploy".
- Sentry error-rate spike correlated with the deploy.

If the cause is clearly the deploy, roll back to the previous container
tag. If the cause is environmental (DB outage, disk full), a rollback
won't help — fix the environment first.

## Pre-flight: identify the previous good version

```bash
# Last 5 deploys (from the deploy_vps.sh history or from git tags)
git -C /opt/youtube_translation log --oneline -5

# Or, from registry tags
docker pull ghcr.io/<org>/youtube_translation-backend:latest
docker images --format '{{.Repository}}:{{.Tag}}\t{{.CreatedAt}}' | grep backend | head
```

You want the SHA tag (e.g. `:abc1234`) from before the broken deploy.

## Rollback procedure

### 1. Disable scheduler so streams aren't auto-started during the swap

```bash
# Tells the backend's scheduler to skip the next tick
psql "$DATABASE_URL" -c "
  INSERT INTO system_settings (key, value)
  VALUES ('scheduler_paused', 'true')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
"
```

(If `system_settings` table doesn't exist, skip this step — the
scheduler will retry on its own and won't stack overlapping starts.)

### 2. Pull the previous image tag

```bash
sudo -u youtube-backend ssh-agent bash -c '
  cd /opt/youtube_translation
  git fetch --all --tags
  git checkout <previous-tag-or-sha>
'
```

### 3. Re-run database migrations idempotently

The Sprint-1 migration runner (`apply_migrations.py`) is auto-confirm
under non-TTY (entrypoint.sh sets `MIGRATIONS_AUTO_CONFIRM=1`). Re-running
on an already-migrated DB is a no-op for everything except migration 037
which conditionally re-adds columns; since it uses `ADD COLUMN IF NOT
EXISTS`, this is safe.

```bash
sudo -u youtube-backend bash -c '
  cd /opt/youtube_translation/backend
  ./.venv/bin/python apply_migrations.py
'
```

If the rollback target is a version BEFORE migration 037, do NOT roll
back the migration — leaving the new columns in place is harmless and
saves a forward roll on the next deploy.

### 4. Swap the host-native backend

```bash
sudo systemctl restart youtube-backend.service
sudo systemctl status youtube-backend.service --no-pager
```

Verify:

```bash
curl -fsS http://127.0.0.1:8000/healthz
# {"status":"alive"}

curl -fsS http://127.0.0.1:8000/readyz
# {"status":"ready","checks":{"db":...,"redis":...,"upload_dir":...}}
```

### 5. Confirm streams survived

```bash
# From the systemd side
systemctl list-units 'ffmpeg@*.service' --no-pager --state=running

# From the DB side
psql "$DATABASE_URL" -c "
  SELECT id, name, status, runtime_last_heartbeat_at
  FROM streams
  WHERE status IN ('running','starting','stopping')
  ORDER BY started_at DESC;
"
```

The `runtime_last_heartbeat_at` column should be advancing on the
running streams; if it's frozen, the new (rolled-back) backend has not
yet reconnected to the per-stream heartbeat protocol — wait 30 seconds
and re-check.

### 6. Re-enable the scheduler

```bash
psql "$DATABASE_URL" -c "
  UPDATE system_settings SET value = 'false' WHERE key = 'scheduler_paused';
"
```

(Skip if you didn't pause it in step 1.)

### 7. Watch metrics for 30 minutes

- `BackendDown` should not fire.
- `StreamErrorSpike` should not fire.
- API latency p95 should be at the previous-version baseline (compare
  to a time window 24h before the bad deploy).

## Rollback failure modes

### "I rolled back but streams are still in `error` state"

The persistent `runtime_restart_attempts` counter in the streams table
saturates the per-stream restart ceiling. Reset for the affected
streams:

```sql
UPDATE streams
SET runtime_restart_attempts = 0,
    runtime_last_failure_at = NULL,
    status = 'stopped'
WHERE id = '<stream-id>' AND user_id = '<user-id>';
```

The user can then click Start again from the dashboard.

### "ffmpeg children are zombies — backend restart didn't see them"

In systemd-mode this should not happen, because the backend reconnects
to existing `ffmpeg@<id>.service` units on startup
(`stream_reconciler.py`). If you see active systemd ffmpeg units that
the backend is NOT tracking:

```bash
# List ffmpeg units
systemctl list-units 'ffmpeg@*.service' --no-pager --state=running

# Stop and restart the backend reconciler
sudo systemctl restart youtube-backend.service

# If still desynced, manually stop the orphan ffmpeg units
sudo systemctl stop ffmpeg@<stream-id>.service
```

### "I need to roll back BEFORE Sprint-1's `/healthz` vs `/readyz` split"

The compose health-check expects `/healthz`. If the rolled-back image
doesn't have `/healthz`, the compose unit will be marked unhealthy and
restart-loop. Edit `docker/docker-compose.yml::backend.healthcheck.test`
to point at `/health` for the duration of the rollback, then revert
when rolling forward.

## Definition of "rollback successful"

1. `systemctl status youtube-backend.service` shows `active (running)`,
   no recent restarts.
2. `/readyz` returns 200 with `db.ok=true`, `redis.ok=true`,
   `upload_dir.ok=true`.
3. `SELECT count(*) FROM streams WHERE status='running'` is at least
   the count from immediately before the bad deploy.
4. New stream creation works (operator opens dashboard, creates a test
   stream, it goes live).
5. Prometheus alerts have cleared (`BackendDown` resolved,
   `BackendApiErrorSpike` cleared).

## Related

- `docs/operations/audit-2026-04-11-host-native-review.md` — host-native
  systemd architecture.
- `scripts/deploy_vps.sh::guard_stream_runtime` — live-stream-aware deploy
  guard that this runbook complements.
- `backend/app/core/stream_reconciler.py` — backend → ffmpeg unit
  reconnect logic.
