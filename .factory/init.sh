#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

mkdir -p   "$BACKEND_DIR/uploads"   "$BACKEND_DIR/streams"   "$BACKEND_DIR/logs"   "$BACKEND_DIR/supervisord/logs"   "$BACKEND_DIR/supervisord/programs"

if [ ! -x "$BACKEND_DIR/.venv/bin/python" ]; then
  python3 -m venv "$BACKEND_DIR/.venv"
fi

if ! "$BACKEND_DIR/.venv/bin/python" -c 'import fastapi' >/dev/null 2>&1; then
  "$BACKEND_DIR/.venv/bin/python" -m pip install --upgrade pip
  "$BACKEND_DIR/.venv/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  (cd "$FRONTEND_DIR" && npm ci)
fi

if [ ! -f "$BACKEND_DIR/.env" ] && [ -f "$BACKEND_DIR/.env.example" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi

if [ ! -f "$FRONTEND_DIR/.env.local" ] && [ -f "$FRONTEND_DIR/.env.example" ]; then
  cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env.local"
fi
