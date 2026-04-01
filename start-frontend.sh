#!/bin/bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_PORT="${API_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
cd "${ROOT_DIR}/frontend"

echo "🚀 Starting Frontend..."
echo "📍 App will be at: http://localhost:${FRONTEND_PORT}"
echo "📊 Dashboard: http://localhost:${FRONTEND_PORT}/dashboard"
echo "🛡️  Admin: http://localhost:${FRONTEND_PORT}/admin"

if [ -z "${NEXT_PUBLIC_API_URL:-}" ]; then
  export NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}/api"
  echo "🔌 NEXT_PUBLIC_API_URL not set. Using default: $NEXT_PUBLIC_API_URL"
else
  echo "🔌 NEXT_PUBLIC_API_URL already set: $NEXT_PUBLIC_API_URL"
fi

if [ "${NEXT_PUBLIC_DEV_BYPASS_AUTH:-0}" = "1" ]; then
  echo "🔓 DEV auth bypass enabled for local smoke/e2e"
fi

echo ""

export PORT="${FRONTEND_PORT}"
npm run dev
