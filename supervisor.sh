#!/bin/bash

# Зручний wrapper для supervisorctl
# Використання: ./supervisor.sh status

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$ROOT_DIR/backend/supervisord.conf"

supervisorctl -c "$CONFIG" "$@"
