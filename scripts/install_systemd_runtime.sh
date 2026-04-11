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

backend_template="$repo_root/docs/systemd/youtube-backend.service.example"
stream_template="$repo_root/docs/systemd/ffmpeg@.service.example"
slice_template="$repo_root/docs/systemd/streaming.slice.example"

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
    "/opt/youtube_translation/.venv/bin/uvicorn": f"{install_root}/.venv/bin/uvicorn",
    "/opt/youtube_translation/.venv/bin/python": f"{install_root}/.venv/bin/python",
    "User=streambot": f"User={service_user}",
    "Group=streambot": f"Group={service_group}",
}
for old, new in replacements.items():
    text = text.replace(old, new)

dest.write_text(text, encoding="utf-8")
PY
}

mkdir -p "$systemd_target_dir"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

render_template "$backend_template" "$tmp_dir/youtube-backend.service"
render_template "$stream_template" "$tmp_dir/ffmpeg@.service"
render_template "$slice_template" "$tmp_dir/streaming.slice"

install -m 0644 "$tmp_dir/youtube-backend.service" "$systemd_target_dir/youtube-backend.service"
install -m 0644 "$tmp_dir/ffmpeg@.service" "$systemd_target_dir/ffmpeg@.service"
install -m 0644 "$tmp_dir/streaming.slice" "$systemd_target_dir/streaming.slice"

echo "Installed systemd unit files into $systemd_target_dir"
echo "  - youtube-backend.service"
echo "  - ffmpeg@.service"
echo "  - streaming.slice"

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
