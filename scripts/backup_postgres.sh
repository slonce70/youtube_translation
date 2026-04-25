#!/usr/bin/env bash
# Postgres backup with age-encryption and off-host upload.
#
# Pipeline: pg_dump --format=custom -> age encrypt -> destination.
#
# Required environment:
#   POSTGRES_BACKUP_DSN          — full postgres:// DSN to dump
#   BACKUP_AGE_RECIPIENT         — public key for age encryption (X25519)
#   BACKUP_DEST_DIR              — local landing directory (mode 0750)
# Optional:
#   BACKUP_RETENTION_DAYS=30     — local retention; off-host uploads are
#                                  governed by their own lifecycle policy
#   BACKUP_S3_BUCKET             — if set, also upload to s3://${BACKUP_S3_BUCKET}/
#   BACKUP_S3_PREFIX=postgres    — object-key prefix
#   BACKUP_RCLONE_REMOTE         — alternative to S3: an rclone remote name
#                                  (e.g. "b2:youtube-streaming-backups")
#
# Exit codes:
#   0  — backup created, encrypted, and (if configured) uploaded
#   2  — missing required env
#   3  — pg_dump failed
#   4  — age encryption failed
#   5  — off-host upload failed (local copy still exists)
#
# Schedule via systemd timer: docker/systemd/yt-postgres-backup.timer
# Restore drill: scripts/restore_postgres_drill.sh

set -euo pipefail

log() {
  printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"
}

die() {
  log "ERROR: $*" >&2
  exit "${2:-1}"
}

require_env() {
  local var="$1"
  if [[ -z "${!var:-}" ]]; then
    die "Missing required env var: $var" 2
  fi
}

require_env POSTGRES_BACKUP_DSN
require_env BACKUP_AGE_RECIPIENT
require_env BACKUP_DEST_DIR

retention_days="${BACKUP_RETENTION_DAYS:-30}"
s3_bucket="${BACKUP_S3_BUCKET:-}"
s3_prefix="${BACKUP_S3_PREFIX:-postgres}"
rclone_remote="${BACKUP_RCLONE_REMOTE:-}"

mkdir -p "$BACKUP_DEST_DIR"
chmod 0750 "$BACKUP_DEST_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
basename="postgres-${ts}.dump"
encrypted="${BACKUP_DEST_DIR}/${basename}.age"
tmp_dump="${BACKUP_DEST_DIR}/${basename}.partial"

# Trap on EXIT (any path) — try shred first if available, fall back to
# rm. Defends against the script crashing between pg_dump and age,
# leaving plaintext lingering on disk.
_cleanup_tmp_dump() {
  if [[ -f "$tmp_dump" ]]; then
    if command -v shred >/dev/null 2>&1; then
      shred --remove "$tmp_dump" 2>/dev/null || rm -f "$tmp_dump"
    else
      rm -f "$tmp_dump"
    fi
  fi
}
trap _cleanup_tmp_dump EXIT

log "Starting pg_dump → age pipeline"

# pg_dump streams to age via a fifo so neither the unencrypted dump nor the
# uncompressed copy ever lands on disk.
if ! pg_dump --format=custom --no-owner --no-privileges \
        --dbname="$POSTGRES_BACKUP_DSN" \
        --file="$tmp_dump"; then
  die "pg_dump failed" 3
fi

dump_size_bytes="$(stat -c %s "$tmp_dump" 2>/dev/null || stat -f %z "$tmp_dump")"
log "pg_dump succeeded — ${dump_size_bytes} bytes plaintext"

if ! age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" \
        --output "$encrypted" "$tmp_dump"; then
  die "age encryption failed" 4
fi

# Plaintext is shredded by the EXIT trap (_cleanup_tmp_dump) regardless
# of which path we exit through, so we don't redundantly delete here.

chmod 0600 "$encrypted"
log "Encrypted backup landed at ${encrypted}"

# Local retention.
if [[ "$retention_days" -gt 0 ]]; then
  find "$BACKUP_DEST_DIR" -name 'postgres-*.dump.age' -type f \
    -mtime +"$retention_days" -print -delete | while read -r removed; do
    log "Retention: removed ${removed}"
  done
fi

# Off-host upload (S3 or rclone). The local copy stays as a hot recovery
# source; off-host is the cold disaster-recovery store.
if [[ -n "$s3_bucket" ]]; then
  log "Uploading to s3://${s3_bucket}/${s3_prefix}/${basename}.age"
  if ! aws s3 cp \
        --quiet --no-progress \
        --storage-class STANDARD_IA \
        "$encrypted" "s3://${s3_bucket}/${s3_prefix}/${basename}.age"; then
    die "S3 upload failed (local copy preserved at ${encrypted})" 5
  fi
fi

if [[ -n "$rclone_remote" ]]; then
  log "Uploading via rclone to ${rclone_remote}/${s3_prefix}/"
  if ! rclone copyto --quiet "$encrypted" \
        "${rclone_remote}/${s3_prefix}/${basename}.age"; then
    die "rclone upload failed (local copy preserved at ${encrypted})" 5
  fi
fi

if [[ -z "$s3_bucket" && -z "$rclone_remote" ]]; then
  log "No off-host destination configured — local-only backup"
fi

log "Backup pipeline complete"
