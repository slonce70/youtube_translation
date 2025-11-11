#!/bin/bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT_DIR}/frontend"

echo "🚀 Starting Frontend..."
echo "📍 App will be at: http://localhost:3000"

if [ -z "${NEXT_PUBLIC_API_URL:-}" ]; then
  export NEXT_PUBLIC_API_URL="http://localhost:8000/api"
  echo "🔌 NEXT_PUBLIC_API_URL not set. Using default: $NEXT_PUBLIC_API_URL"
else
  echo "🔌 NEXT_PUBLIC_API_URL already set: $NEXT_PUBLIC_API_URL"
fi

echo ""

npm run dev
