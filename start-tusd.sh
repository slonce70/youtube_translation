#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT_DIR}"

TUSD_PORT="${TUSD_PORT:-1080}"

echo "🚀 Starting tusd (upload server) with quota enforcement..."
echo "📍 Upload endpoint: http://localhost:${TUSD_PORT}/files/"
echo ""

# Добавляем GOPATH/bin в PATH, если tusd установлен через go install
export PATH="$HOME/go/bin:$PATH"

# Создаем общую папку с бэкендом
UPLOAD_ROOT="${ROOT_DIR}/backend/uploads"
TEMP_DIR="${UPLOAD_ROOT}/_temp"
HOOKS_DIR="${ROOT_DIR}/backend/tusd-hooks"

export TUSD_UPLOAD_ROOT="$UPLOAD_ROOT"

# Загружаем переменные окружения для совместного секрета
if [ -f "${ROOT_DIR}/backend/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "${ROOT_DIR}/backend/.env"
    set +a
else
    echo "ℹ️  backend/.env не знайдено. Використовую значення середовища для tusd."
fi

if [ -z "${TUSD_HMAC_SECRET:-}" ]; then
    echo "❌ TUSD_HMAC_SECRET не задан. Добавьте его в backend/.env перед запуском tusd." >&2
    exit 1
fi

if [ -z "${UPLOAD_TOKEN_SECRET:-}" ]; then
    echo "❌ UPLOAD_TOKEN_SECRET не задан. Добавьте его в backend/.env перед запуском tusd." >&2
    exit 1
fi

mkdir -p "${UPLOAD_ROOT}"
mkdir -p "${TEMP_DIR}"

echo "📂 Upload root: ${UPLOAD_ROOT}"
echo "📂 Temp directory: ${TEMP_DIR}"
echo "📂 Hooks directory: ${HOOKS_DIR}"
echo "🔐 Using HMAC signature for tusd hooks"
echo ""

# Проверяем tusd
if ! command -v tusd &> /dev/null; then
    echo "❌ tusd не установлен!"
    echo ""
    echo "Установите вручную:"
    echo "1. Скачайте: https://github.com/tus/tusd/releases/latest"
    echo "2. Распакуйте в /usr/local/bin/"
    echo ""
    echo "Или запустите без загрузки файлов (только для теста UI)"
    exit 1
fi

# Проверяем hooks
if [ ! -f "${HOOKS_DIR}/pre-create" ] || [ ! -f "${HOOKS_DIR}/post-finish" ]; then
    echo "⚠️  WARNING: Tusd hooks not found!"
    echo "   Quota checks will not work."
    echo "   Run: python3 backend/scripts/create_user_dirs.py"
    echo ""
fi

# Запускаем tusd с hooks и временной директорией
echo "🎯 Starting with quota enforcement and file isolation..."
echo ""

tusd \
     -port="${TUSD_PORT}" \
     -upload-dir="${TEMP_DIR}" \
     -hooks-dir="${HOOKS_DIR}" \
     -hooks-enabled-events=pre-create,post-finish \
     -behind-proxy \
     -base-path=/files/ \
     -max-size=10737418240
