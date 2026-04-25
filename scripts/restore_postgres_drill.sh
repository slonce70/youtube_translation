#!/usr/bin/env bash
# Postgres restore drill — verifies that a backup tape is actually
# decryptable AND restorable into a known-good schema. Runs against an
# ephemeral DB so the production cluster is never touched.
#
# Required env:
#   BACKUP_AGE_IDENTITY    — path to the age private key (X25519)
#   BACKUP_DEST_DIR        — where backup_postgres.sh wrote .dump.age files
#   DRILL_PG_HOST          — postgres host for the ephemeral DB
#   DRILL_PG_USER          — superuser on DRILL_PG_HOST (for CREATE DATABASE)
#   DRILL_PG_PASSWORD      — password (or PGPASSFILE)
# Optional:
#   DRILL_PG_PORT=5432
#   DRILL_BACKUP_FILE      — explicit backup file; default = newest in BACKUP_DEST_DIR
#   DRILL_PG_DBNAME        — ephemeral DB name; default = "drill_$(date)"
#
# Exit codes:
#   0  — restore completed and at least one expected table is present
#   2  — missing env
#   3  — no backup file found
#   4  — age decryption failed
#   5  — pg_restore failed
#   6  — schema check failed (restored DB doesn't look right)
#
# Run via systemd timer: docker/systemd/yt-postgres-restore-drill.timer
# (monthly). Pipeline emits a CI-consumable summary on stdout.

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

require_env BACKUP_AGE_IDENTITY
require_env BACKUP_DEST_DIR
require_env DRILL_PG_HOST
require_env DRILL_PG_USER
require_env DRILL_PG_PASSWORD

drill_pg_port="${DRILL_PG_PORT:-5432}"
drill_dbname="${DRILL_PG_DBNAME:-drill_$(date -u +%Y%m%d_%H%M%S)}"

backup_file="${DRILL_BACKUP_FILE:-}"
if [[ -z "$backup_file" ]]; then
  # Newest .dump.age in BACKUP_DEST_DIR.
  backup_file="$(ls -1t "$BACKUP_DEST_DIR"/postgres-*.dump.age 2>/dev/null | head -n 1 || true)"
fi
if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
  die "No backup file found in ${BACKUP_DEST_DIR}" 3
fi
log "Drill target: ${backup_file}"

scratch_dir="$(mktemp -d)"
trap 'rm -rf "$scratch_dir"; PGPASSWORD="$DRILL_PG_PASSWORD" psql -h "$DRILL_PG_HOST" -p "$drill_pg_port" -U "$DRILL_PG_USER" -d postgres -tc "DROP DATABASE IF EXISTS \"$drill_dbname\";" >/dev/null 2>&1 || true' EXIT

decrypted="${scratch_dir}/restored.dump"

log "Decrypting via age"
if ! age --decrypt --identity "$BACKUP_AGE_IDENTITY" \
        --output "$decrypted" "$backup_file"; then
  die "age decryption failed" 4
fi

log "Creating ephemeral database ${drill_dbname}"
PGPASSWORD="$DRILL_PG_PASSWORD" psql \
  -h "$DRILL_PG_HOST" -p "$drill_pg_port" -U "$DRILL_PG_USER" \
  -d postgres -tc "CREATE DATABASE \"$drill_dbname\";" >/dev/null

log "Running pg_restore"
if ! PGPASSWORD="$DRILL_PG_PASSWORD" pg_restore \
        --no-owner --no-privileges \
        --dbname="postgresql://${DRILL_PG_USER}@${DRILL_PG_HOST}:${drill_pg_port}/${drill_dbname}" \
        "$decrypted"; then
  die "pg_restore failed (database left in place for inspection: ${drill_dbname})" 5
fi

log "Verifying restored schema"
expected_tables=(
  user_profiles
  destinations
  streams
  assets
  playlists
  media_collections
  subscription_tier_limits
)

missing=()
for table in "${expected_tables[@]}"; do
  count="$(PGPASSWORD="$DRILL_PG_PASSWORD" psql \
    -h "$DRILL_PG_HOST" -p "$drill_pg_port" -U "$DRILL_PG_USER" \
    -d "$drill_dbname" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='${table}';")"
  if [[ "$count" != "1" ]]; then
    missing+=("$table")
  fi
done

if [[ "${#missing[@]}" -gt 0 ]]; then
  die "Schema check failed — missing tables: ${missing[*]}" 6
fi

log "Schema OK — restore drill PASSED for ${backup_file}"
log "Ephemeral DB ${drill_dbname} will be dropped by trap"
