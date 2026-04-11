#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
systemd_target_dir="${SYSTEMD_TARGET_DIR:-/etc/systemd/system}"
install_root="${SYSTEMD_INSTALL_ROOT:-/opt/youtube_translation}"
service_user="${SYSTEMD_SERVICE_USER:-streambot}"
service_group="${SYSTEMD_SERVICE_GROUP:-$service_user}"
skip_reload="${SYSTEMD_SKIP_RELOAD:-0}"
enable_backend="${SYSTEMD_ENABLE_BACKEND:-0}"
enable_stream_unit="${SYSTEMD_ENABLE_STREAM_UNIT:-}"
install_polkit="${SYSTEMD_INSTALL_POLKIT:-0}"
polkit_rules_dir="${SYSTEMD_POLKIT_RULES_DIR:-/etc/polkit-1/rules.d}"
ensure_service_account="${SYSTEMD_ENSURE_SERVICE_ACCOUNT:-1}"
align_env_permissions="${SYSTEMD_ALIGN_ENV_PERMISSIONS:-1}"

backend_template="$repo_root/docs/systemd/youtube-backend.service.example"
stream_template="$repo_root/docs/systemd/ffmpeg@.service.example"
slice_template="$repo_root/docs/systemd/streaming.slice.example"
polkit_template="$repo_root/docs/systemd/polkit/youtube-ffmpeg.rules.example"
stream_runner_script="$repo_root/scripts/run_stream_systemd.sh"

group_exists() {
  local target_group="$1"

  if command -v getent >/dev/null 2>&1; then
    getent group "$target_group" >/dev/null 2>&1
    return $?
  fi

  grep -q "^${target_group}:" /etc/group 2>/dev/null
}

user_exists() {
  local target_user="$1"
  id "$target_user" >/dev/null 2>&1
}

ensure_service_account_present() {
  if [[ "$ensure_service_account" != "1" ]]; then
    echo "Skipping service account provisioning because SYSTEMD_ENSURE_SERVICE_ACCOUNT=0"
    return 0
  fi

  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "Skipping service account provisioning on non-Linux host."
    return 0
  fi

  local service_group_ready=0

  if group_exists "$service_group"; then
    service_group_ready=1
  else
    echo "Creating system group $service_group..."
    groupadd --system "$service_group"
    service_group_ready=1
  fi

  if user_exists "$service_user"; then
    return 0
  fi

  echo "Creating system user $service_user..."
  local useradd_args=(
    --system
    --home-dir "$install_root"
    --create-home
    --shell /usr/sbin/nologin
  )
  if [[ "$service_group_ready" == "1" ]]; then
    useradd_args+=(--gid "$service_group")
  fi
  useradd "${useradd_args[@]}" "$service_user"
}

align_backend_env_permissions() {
  local backend_env_file="$install_root/backend/.env"

  if [[ "$align_env_permissions" != "1" ]]; then
    echo "Skipping backend env permission alignment because SYSTEMD_ALIGN_ENV_PERMISSIONS=0"
    return 0
  fi

  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "Skipping backend env permission alignment on non-Linux host."
    return 0
  fi

  if [[ ! -f "$backend_env_file" ]]; then
    echo "Skipping backend env permission alignment because $backend_env_file is missing"
    return 0
  fi

  echo "Granting $service_user read access to $backend_env_file..."
  chgrp "$service_group" "$backend_env_file"
  chmod 0640 "$backend_env_file"
}

render_template() {
  local src="$1"
  local dest="$2"

  python3 - "$src" "$dest" "$install_root" "$service_user" "$service_group" <<'PY'
from pathlib import Path
import sys

src = Path(sys.argv[1])
dest = Path(sys.argv[2])
install_root = sys.argv[3].rstrip("/")
service_user = sys.argv[4]
service_group = sys.argv[5]

text = src.read_text(encoding="utf-8")
replacements = {
    "/opt/youtube_translation/backend": f"{install_root}/backend",
    "/opt/youtube_translation/backend/.venv/bin/uvicorn": f"{install_root}/backend/.venv/bin/uvicorn",
    "/opt/youtube_translation/.venv/bin/python": f"{install_root}/backend/.venv/bin/python",
    "/opt/youtube_translation/scripts/run_stream_systemd.sh": f"{install_root}/scripts/run_stream_systemd.sh",
    "User=streambot": f"User={service_user}",
    "Group=streambot": f"Group={service_group}",
    'subject.user !== "streambot"': f'subject.user !== "{service_user}"',
}
for old, new in replacements.items():
    text = text.replace(old, new)

dest.write_text(text, encoding="utf-8")
PY
}

ensure_service_account_present
align_backend_env_permissions

mkdir -p "$systemd_target_dir"
mkdir -p "$install_root/scripts"
if [[ "$install_polkit" == "1" ]]; then
  mkdir -p "$polkit_rules_dir"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

render_template "$backend_template" "$tmp_dir/youtube-backend.service"
render_template "$stream_template" "$tmp_dir/ffmpeg@.service"
render_template "$slice_template" "$tmp_dir/streaming.slice"
render_template "$stream_runner_script" "$tmp_dir/run_stream_systemd.sh"
if [[ "$install_polkit" == "1" ]]; then
  render_template "$polkit_template" "$tmp_dir/50-youtube-ffmpeg.rules"
fi

install -m 0644 "$tmp_dir/youtube-backend.service" "$systemd_target_dir/youtube-backend.service"
install -m 0644 "$tmp_dir/ffmpeg@.service" "$systemd_target_dir/ffmpeg@.service"
install -m 0644 "$tmp_dir/streaming.slice" "$systemd_target_dir/streaming.slice"
install -m 0755 "$tmp_dir/run_stream_systemd.sh" "$install_root/scripts/run_stream_systemd.sh"
if [[ "$install_polkit" == "1" ]]; then
  install -m 0644 "$tmp_dir/50-youtube-ffmpeg.rules" "$polkit_rules_dir/50-youtube-ffmpeg.rules"
fi

echo "Installed systemd unit files into $systemd_target_dir"
echo "  - youtube-backend.service"
echo "  - ffmpeg@.service"
echo "  - streaming.slice"
echo "  - run_stream_systemd.sh"
if [[ "$install_polkit" == "1" ]]; then
  echo "Installed polkit rule into $polkit_rules_dir/50-youtube-ffmpeg.rules"
fi

if [[ "$skip_reload" == "1" ]]; then
  echo "Skipping systemd daemon-reload because SYSTEMD_SKIP_RELOAD=1"
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required unless SYSTEMD_SKIP_RELOAD=1" >&2
  exit 1
fi

systemctl daemon-reload
echo "systemd daemon-reload completed."
if [[ "$enable_backend" == "1" ]]; then
  systemctl enable --now youtube-backend
  echo "Enabled and started youtube-backend"
fi
if [[ -n "$enable_stream_unit" ]]; then
  systemctl enable --now "ffmpeg@${enable_stream_unit}"
  echo "Enabled and started ffmpeg@${enable_stream_unit}"
fi
echo "Next steps:"
if [[ "$enable_backend" != "1" ]]; then
  echo "  systemctl enable --now youtube-backend"
fi
if [[ -z "$enable_stream_unit" ]]; then
  echo "  systemctl enable --now ffmpeg@<stream_uuid>"
fi
