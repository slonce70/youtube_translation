#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
shopt -s nullglob

repo_root="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")/.." && /bin/pwd)"
backend_dir="${SYSTEMD_BACKEND_DIR:-$repo_root/backend}"
backend_venv_dir="${SYSTEMD_BACKEND_VENV_DIR:-$backend_dir/.venv}"
repo_venv_dir="${SYSTEMD_REPO_VENV_DIR:-$repo_root/.venv}"
preferred_python="${SYSTEMD_PYTHON_BIN:-}"
log_dir="${SYSTEMD_LOG_DIR:-$repo_root/backend/logs}"
stream_id="${1:-}"

if [[ -z "$stream_id" ]]; then
  echo "stream_id argument is required" >&2
  exit 1
fi

cd "$backend_dir"
export PYTHONPATH="$backend_dir"
/bin/mkdir -p "$log_dir"
wrapper_log="$log_dir/systemd-run-stream-${stream_id}.log"
{
  echo "[$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)] starting run_stream_systemd wrapper"
  echo "backend_dir=$backend_dir"
  echo "backend_venv_dir=$backend_venv_dir"
  echo "repo_venv_dir=$repo_venv_dir"
  echo "preferred_python=${preferred_python:-<auto>}"
  echo "stream_id=$stream_id"
} >>"$wrapper_log"

candidate_python_bins=()
if [[ -n "$preferred_python" ]]; then
  candidate_python_bins+=("$preferred_python")
fi
candidate_python_bins+=(
  "$backend_venv_dir/bin/python"
  "$backend_venv_dir/bin/python3"
  "$backend_venv_dir"/bin/python3.*
  "$repo_venv_dir/bin/python"
  "$repo_venv_dir/bin/python3"
  "$repo_venv_dir"/bin/python3.*
)

resolved_python=""
for candidate in "${candidate_python_bins[@]}"; do
  if [[ ! -x "$candidate" ]]; then
    continue
  fi
  if "$candidate" -V >>"$wrapper_log" 2>&1; then
    resolved_python="$candidate"
    echo "[$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)] resolved_python=$resolved_python" >>"$wrapper_log"
    break
  fi
  exit_code=$?
  echo "[$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)] python_version_probe_failed=$exit_code candidate=$candidate" >>"$wrapper_log"
done

if [[ -z "$resolved_python" ]]; then
  exit 127
fi

"$resolved_python" -m app.cli.run_stream "$stream_id" >>"$wrapper_log" 2>&1
exit_code=$?
echo "[$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)] wrapper exit_code=$exit_code" >>"$wrapper_log"
exit "$exit_code"
