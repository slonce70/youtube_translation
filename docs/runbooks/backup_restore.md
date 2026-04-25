# Runbook — Postgres backup and restore

How to take a backup, verify it, and restore from it. The pipeline is
documented in `scripts/backup_postgres.sh` (encrypt + ship) and
`scripts/restore_postgres_drill.sh` (decrypt + smoke-restore).

## Architecture

```
Production cluster                   Backup host                     Off-host store
┌─────────────────┐  pg_dump | age   ┌─────────────────────┐  S3 PUT  ┌────────────┐
│ youtube-streaming│ ────────────▶  │ /var/lib/youtube-    │ ────────▶│ s3://...   │
│ (Postgres 16)   │                  │ backups/postgres/    │          │ (Glacier)  │
└─────────────────┘                  │ postgres-*.dump.age  │          └────────────┘
                                     └──────────┬───────────┘
                                                │ scripts/restore_postgres_drill.sh
                                                ▼
                                     ┌─────────────────────┐
                                     │ ephemeral DB:       │
                                     │ drill_<timestamp>   │
                                     │ (DROPped on exit)   │
                                     └─────────────────────┘
```

## Daily backup

The `yt-postgres-backup.timer` fires `yt-postgres-backup.service` at
03:17 UTC daily. The unit reads `/etc/youtube-streaming/backup.env`
which must contain:

```
POSTGRES_BACKUP_DSN=postgres://backup_user:***@127.0.0.1:5432/youtube_streaming
BACKUP_AGE_RECIPIENT=age1q...   # PUBLIC key (NEVER paste a private/identity here)
BACKUP_DEST_DIR=/var/lib/youtube-backups/postgres
BACKUP_RETENTION_DAYS=30
BACKUP_S3_BUCKET=youtube-streaming-backups
BACKUP_S3_PREFIX=postgres
```

`backup_user` is a read-only role on the production cluster:

```sql
CREATE ROLE backup_user WITH LOGIN PASSWORD '<long-random>';
GRANT CONNECT ON DATABASE youtube_streaming TO backup_user;
GRANT USAGE ON SCHEMA public TO backup_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_user;
```

After install:

```bash
systemctl daemon-reload
systemctl enable --now yt-postgres-backup.timer
systemctl list-timers yt-postgres-backup.timer   # confirm next firing time
```

To run on demand (e.g. before a risky migration):

```bash
systemctl start yt-postgres-backup.service
journalctl -u yt-postgres-backup.service --since '5 min ago'
```

## Verifying a backup is good

The `yt-postgres-restore-drill.timer` fires monthly (first Sunday at 04:00
UTC) and runs `restore_postgres_drill.sh`. The drill:

1. Picks the newest `*.dump.age` from `BACKUP_DEST_DIR`.
2. Decrypts via `age` using the identity at `BACKUP_AGE_IDENTITY`.
3. Creates an ephemeral DB on `DRILL_PG_HOST`.
4. Runs `pg_restore` into that DB.
5. Verifies 7 expected tables exist (`user_profiles`, `destinations`,
   `streams`, `assets`, `playlists`, `media_collections`,
   `subscription_tier_limits`).
6. Drops the ephemeral DB.

To run the drill on demand against a specific backup:

```bash
DRILL_BACKUP_FILE=/var/lib/youtube-backups/postgres/postgres-20260101T031700Z.dump.age \
  systemctl start yt-postgres-restore-drill.service
journalctl -u yt-postgres-restore-drill.service --since '10 min ago'
```

The expected last-line on success is:

```
[<ts>] Schema OK — restore drill PASSED for <file>
```

If the drill fails, **STOP** and investigate before relying on the backup.
The most likely failure modes:

- `age decryption failed` → `BACKUP_AGE_IDENTITY` doesn't match the
  `BACKUP_AGE_RECIPIENT` that wrote the file. Recover the correct identity
  or accept that backups since the recipient rotation are unrecoverable.
- `pg_restore failed` → backup file is truncated or corrupted; re-run a
  fresh `backup_postgres.service` and re-drill.
- `Schema check failed` → restore succeeded but the database doesn't look
  like a youtube-streaming database. Probably the wrong source DSN was
  configured. Compare `\dt` between the prod cluster and the ephemeral DB.

## Disaster recovery — full restore to a fresh box

You're on a new VPS, the old one is gone, and you need to rebuild
production from the latest off-host backup.

### 0. Pre-flight

- New VPS has Postgres 16 installed, started, and accepting local
  connections.
- `age` is installed (`apt install age` on Ubuntu 22.04+).
- `aws` CLI (or `rclone`) is configured with read access to the off-host
  bucket.
- The age **identity** (private key) is restored from your secret
  manager / sealed envelope. **Without the identity, the backup is
  permanently unrecoverable.** This is by design.

### 1. Pull the freshest backup

```bash
mkdir -p /var/lib/youtube-backups/postgres
cd /var/lib/youtube-backups/postgres

# List all available backups, newest first
aws s3 ls s3://youtube-streaming-backups/postgres/ --human-readable | \
  sort -k1,2 -r | head -20

# Pull the newest (substitute the actual filename)
aws s3 cp s3://youtube-streaming-backups/postgres/postgres-20260420T031700Z.dump.age .
```

### 2. Decrypt

```bash
age --decrypt --identity ~/.config/youtube-streaming/backup-identity.txt \
    --output /tmp/restore.dump postgres-20260420T031700Z.dump.age
```

### 3. Create the target database + restore

```bash
sudo -u postgres createdb youtube_streaming_restored
sudo -u postgres pg_restore --no-owner --no-privileges \
    --dbname=youtube_streaming_restored /tmp/restore.dump

# Re-grant ownership to the application user.
sudo -u postgres psql youtube_streaming_restored <<SQL
ALTER DATABASE youtube_streaming_restored OWNER TO youtube_user;
GRANT ALL ON SCHEMA public TO youtube_user;
SQL
```

Sanity-check before swapping:

```bash
sudo -u postgres psql youtube_streaming_restored -c '\dt'
sudo -u postgres psql youtube_streaming_restored -c 'SELECT count(*) FROM streams;'
sudo -u postgres psql youtube_streaming_restored -c 'SELECT count(*) FROM destinations;'
```

### 4. Cut over

If the application is also running on this box, point its `DATABASE_URL`
at the new database and restart the backend:

```bash
# Edit /etc/youtube-streaming/backend.env: DATABASE_URL=postgresql://youtube_user:***@127.0.0.1:5432/youtube_streaming_restored
systemctl restart youtube-backend.service
curl -fsS http://127.0.0.1:8000/readyz   # JSON should show db.ok=true
```

If you intend to use the old database name, rename:

```bash
sudo -u postgres psql -c 'ALTER DATABASE youtube_streaming RENAME TO youtube_streaming_old;'
sudo -u postgres psql -c 'ALTER DATABASE youtube_streaming_restored RENAME TO youtube_streaming;'
systemctl restart youtube-backend.service
```

### 5. Replay the encryption-key rotation

If `ENCRYPTION_KEY` rotated between the backup snapshot and now, the
encrypted columns won't decrypt with the current primary key. Either:

- Set `ENCRYPTION_KEY_PREVIOUS` to the key in force at the time of the
  backup, then run `python -m scripts.rotate_encryption_keys` to rewrap
  to the current primary; OR
- Roll the platform's `ENCRYPTION_KEY` back to the value that was active
  at backup time (last resort — security sensitive).

See `docs/runbooks/encryption_rotation.md` for the rotation procedure.

### 6. Restore /uploads

The Postgres backup carries no media files. Run the corresponding uploads
restore from the rsync hard-link snapshots produced by
`scripts/backup_uploads.sh`:

```bash
# Latest snapshot pointer is /var/lib/youtube-backups/uploads/latest
sudo rsync -aH --delete /var/lib/youtube-backups/uploads/latest/ \
                        /opt/youtube_translation_data/uploads/
sudo chown -R youtube-backend:youtube-backend /opt/youtube_translation_data/uploads
```

Restart `youtube-backend.service` so the new file tree is observed.

## Acceptance criteria

A "successful restore" means:

1. `/readyz` returns 200 with `db.ok=true`, `redis.ok=true`,
   `upload_dir.ok=true`.
2. `SELECT count(*) FROM streams` matches the count from the source DB
   at backup time (within tolerance for the gap).
3. A test user can log in (Supabase JWT verifies, profile loads).
4. Stream-key decryption works: open any destination in the dashboard
   and the masked key renders without errors.

If any of these fail, **stop**, do not promote to production traffic,
and investigate.

## Recovery time objective

Targeting RTO < 60 minutes for a fresh-box restore from off-host
backups, given:

- Network: 100 Mbps inbound minimum (a 2 GB compressed backup pulls in
  ~3 minutes).
- Postgres restore: ~5–15 minutes for a 5 GB compressed dump.
- Manual cutover steps: ~5 minutes.

The largest variable is the operator's familiarity with the procedure.
Run a full DR drill against a sandbox VPS at least quarterly.

## Related

- `scripts/backup_postgres.sh` — daily backup pipeline.
- `scripts/restore_postgres_drill.sh` — monthly automated drill.
- `scripts/backup_uploads.sh` — `/uploads` rsync snapshots.
- `docs/systemd/yt-postgres-backup.{service,timer}.example` — systemd templates.
- `docs/systemd/yt-postgres-restore-drill.{service,timer}.example` — drill templates.
- `docs/systemd/yt-uploads-backup.{service,timer}.example` — uploads templates.
- `docs/runbooks/encryption_rotation.md` — paired rotation procedure.
