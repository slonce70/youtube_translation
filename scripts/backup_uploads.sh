#!/usr/bin/env bash
# Snapshot the per-tenant uploads tree to an off-host volume using
# rsync hard-link snapshots. Each daily snapshot is a directory of
# hard-links to the previous day's snapshot; only changed files consume
# additional disk. Lifecycle pruning keeps a configurable retention.
#
# Required env:
#   UPLOADS_SRC_DIR        — source path (e.g. /opt/youtube_translation_data/uploads)
#   UPLOADS_BACKUP_ROOT    — destination root (off-host volume mounted on the box)
# Optional:
#   UPLOADS_RETENTION_DAYS=14
#   UPLOADS_RSYNC_REMOTE   — rsync over ssh, e.g. backup@b2.example.com:/srv/uploads
#                            If set, snapshots are pushed to remote AFTER local copy.
#
# This is a *crash-consistent* snapshot — the backend may be writing to
# tusd uploads concurrently. Tusd writes to .info side-files first then
# renames the data file atomically, so a snapshot taken mid-upload will
# either see the in-progress .info+.partial pair (will be re-uploaded)
# OR the finalized file. No half-files lost.

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

require_env UPLOADS_SRC_DIR
require_env UPLOADS_BACKUP_ROOT

retention_days="${UPLOADS_RETENTION_DAYS:-14}"
rsync_remote="${UPLOADS_RSYNC_REMOTE:-}"

if [[ ! -d "$UPLOADS_SRC_DIR" ]]; then
  die "Source missing: $UPLOADS_SRC_DIR" 3
fi

mkdir -p "$UPLOADS_BACKUP_ROOT"
chmod 0750 "$UPLOADS_BACKUP_ROOT"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
snap="${UPLOADS_BACKUP_ROOT}/snapshot-${ts}"
latest_link="${UPLOADS_BACKUP_ROOT}/latest"

# Resolve the previous snapshot for hard-link reuse. ls -1tdr lists oldest
# first; we want newest.
previous="$(ls -1dt "$UPLOADS_BACKUP_ROOT"/snapshot-* 2>/dev/null | head -n 1 || true)"

rsync_args=(
  --archive --hard-links --xattrs --acls
  --delete --delete-excluded
  --quiet
  --exclude '_temp/'
  --exclude '*.partial'
  --exclude '.tusd-uploads/'
)

if [[ -n "$previous" && -d "$previous" ]]; then
  log "Using previous snapshot for hard-link reuse: ${previous}"
  rsync_args+=( --link-dest "$previous" )
fi

log "Creating snapshot: ${snap}"
rsync "${rsync_args[@]}" "${UPLOADS_SRC_DIR}/" "${snap}/"

# Update the convenience `latest` symlink atomically.
ln -sfn "$snap" "${latest_link}.tmp"
mv -Tf "${latest_link}.tmp" "$latest_link"

log "Local snapshot complete"

# Optional remote push. With --link-dest hard-links are flattened during
# transfer (rsync replicates content), so the remote receives a full copy
# of *only changed* files vs the previous remote snapshot — handled by
# remote --link-dest if symmetric.
if [[ -n "$rsync_remote" ]]; then
  log "Pushing to remote: ${rsync_remote}/snapshot-${ts}"
  if ! rsync --archive --hard-links --xattrs --acls --quiet \
        --link-dest "${rsync_remote}/latest" \
        "${snap}/" "${rsync_remote}/snapshot-${ts}/"; then
    log "WARN: remote push failed (local snapshot preserved)"
    exit 4
  fi

  # Update remote `latest` pointer via ssh.
  if [[ "$rsync_remote" == *":"* ]]; then
    remote_host="${rsync_remote%%:*}"
    remote_path="${rsync_remote#*:}"
    if ! ssh -o BatchMode=yes "$remote_host" \
          "ln -sfn '${remote_path}/snapshot-${ts}' '${remote_path}/latest.tmp' && mv -Tf '${remote_path}/latest.tmp' '${remote_path}/latest'"; then
      log "WARN: remote latest pointer update failed"
    fi
  fi
fi

# Local retention.
if [[ "$retention_days" -gt 0 ]]; then
  find "$UPLOADS_BACKUP_ROOT" -maxdepth 1 -name 'snapshot-*' -type d \
    -mtime +"$retention_days" -print | while read -r removed; do
    log "Retention: removing ${removed}"
    rm -rf "$removed"
  done
fi

log "Uploads backup pipeline complete"
