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
  export NEXT_PUBLIC_API_URL="/api"
  echo "🔌 NEXT_PUBLIC_API_URL not set. Using same-origin default: $NEXT_PUBLIC_API_URL"
else
  echo "🔌 NEXT_PUBLIC_API_URL already set: $NEXT_PUBLIC_API_URL"
fi

if [ -z "${NEXT_PUBLIC_TUSD_URL:-}" ]; then
  export NEXT_PUBLIC_TUSD_URL="http://localhost:1080"
  echo "📦 NEXT_PUBLIC_TUSD_URL not set. Using local tusd default: $NEXT_PUBLIC_TUSD_URL"
else
  echo "📦 NEXT_PUBLIC_TUSD_URL already set: $NEXT_PUBLIC_TUSD_URL"
fi

if [ "${NEXT_PUBLIC_DEV_BYPASS_AUTH:-0}" = "1" ]; then
  echo "🔓 DEV auth bypass enabled for local smoke/e2e"
fi

echo ""

export PORT="${FRONTEND_PORT}"

if [ -d ".next" ]; then
  HAS_DEV_LAYOUT_CSS=0
  HAS_PROD_HASHED_CSS=0
  MANIFEST_EXPECTS_LAYOUT_CSS=0

  if [ -f ".next/static/css/app/layout.css" ]; then
    HAS_DEV_LAYOUT_CSS=1
  fi

  if find ".next/static/css" -maxdepth 1 -type f -name '*.css' 2>/dev/null | grep -q .; then
    HAS_PROD_HASHED_CSS=1
  fi

  if [ -f ".next/app-build-manifest.json" ] && grep -q '"static/css/app/layout.css"' ".next/app-build-manifest.json"; then
    MANIFEST_EXPECTS_LAYOUT_CSS=1
  fi

  if [ "${HAS_DEV_LAYOUT_CSS}" -eq 0 ] && { [ "${HAS_PROD_HASHED_CSS}" -eq 1 ] || [ "${MANIFEST_EXPECTS_LAYOUT_CSS}" -eq 1 ]; }; then
    echo "🧹 Detected stale Next.js cache that can break CSS in dev mode. Resetting .next..."
    rm -rf .next
  fi
fi

npm run dev
