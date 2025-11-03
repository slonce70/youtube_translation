#!/bin/bash
cd "$(dirname "$0")"

echo "🚀 Starting tusd (upload server)..."
echo "📍 Upload endpoint: http://localhost:8080/files/"
echo ""

# Создаем папку
mkdir -p uploads

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

# Запускаем
tusd -port=8080 \
     -upload-dir=./uploads \
     -hooks-http=http://localhost:8000/api/assets/webhook \
     -behind-proxy
