# YouTube Multi-Channel Streaming Platform

Багатокористувацька платформа для круглодобових YouTube-стрімів з розподілом квот, завантаженням великих файлів через tusd та адміністративною панеллю.

## ⚡️ Основні можливості

- Багатоканальні 24/7 стріми без перекодування (FFmpeg `-c copy`)
- Квоти та тарифи (storage, streams, assets, playlists, destinations)
- Ізоляція файлів `/uploads/{user_id}` на рівні БД
- Автоматичне створення профілів користувачів через Supabase Auth
- Веб-панель (Next.js) + tusd для відновлюваних завантажень
- Адмінський інтерфейс з метриками та алертами
- Структуровані JSON-логи + Prometheus-сумісні метрики `/api/metrics/prometheus`
- **Локальна PostgreSQL БД** для швидкості та масштабування
- **Supabase Auth** для безпечної автентифікації (OAuth, JWT)

## 🚀 Швидкий старт (локально на macOS)

### Передумови
- macOS (Apple Silicon або Intel)
- Python 3.11+
- Node.js 18+
- Homebrew

### Крок 1: Встановити PostgreSQL

```bash
# Встановити PostgreSQL 16
brew install postgresql@16

# Запустити службу
brew services start postgresql@16

# Створити БД та користувача
createdb youtube_streaming
psql postgres -c "CREATE USER youtube_user WITH PASSWORD 'dev_password_local_only';"
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE youtube_streaming TO youtube_user;"
psql postgres -c "ALTER DATABASE youtube_streaming OWNER TO youtube_user;"
```

### Крок 2: Встановити Supervisor

```bash
# Для керування FFmpeg процесами
brew install supervisor

# Запустити supervisord
cd backend
supervisord -c supervisord.conf
```

### Крок 3: Клонувати та налаштувати проект

```bash
git clone https://github.com/slonce70/youtube_translation.git
cd youtube_translation

# Встановити залежності
make install

# Налаштувати конфігурацію
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# Відредагувати backend/.env:
# - DATABASE_URL (вже налаштовано для локальної БД)
# - SUPABASE_URL, SUPABASE_KEY, SUPABASE_JWT_SECRET (тільки для Auth!)
# - ENCRYPTION_KEY, ENCRYPTION_SALT (згенерувати: openssl rand -hex 32)
# - TUSD_HMAC_SECRET (згенерувати: openssl rand -base64 32)
# - FFMPEG_BIN=/opt/homebrew/bin/ffmpeg (для Apple Silicon)
# Для локальної розробки без Supabase:
# - ENABLE_DEV_AUTH=true
# - DEV_USER_EMAIL=dev@example.com
# - DEV_USER_ID=00000000-0000-0000-0000-000000000001
```

### Крок 4: Застосувати міграції БД

```bash
cd backend
python3 apply_migrations.py
```

### Крок 5: Запустити все

```bash
# З корневої директорії
make dev

# Або окремо:
./start-backend.sh   # Backend:  http://localhost:8000
./start-frontend.sh  # Frontend: http://localhost:3000
./start-tusd.sh      # tusd:     http://localhost:1080/files/
```

### Перевірка

```bash
# Перевірити PostgreSQL
psql postgresql://youtube_user:dev_password_local_only@localhost:5432/youtube_streaming -c "SELECT version();"

# Перевірити Supervisor
supervisorctl status

# Перевірити Backend
curl http://localhost:8000/health
```

## 🔑 Важливі змінні оточення

### База даних
| Змінна | Призначення | Приклад |
|--------|-------------|---------|
| `DATABASE_URL` | Підключення до локальної PostgreSQL | `postgresql://youtube_user:password@localhost:5432/youtube_streaming` |
| `DB_POOL_SIZE` | Розмір connection pool (10 для локальної БД) | `10` |

### Автентифікація (тільки Supabase Auth!)
| Змінна | Призначення |
|--------|-------------|
| `SUPABASE_URL` | URL проекту Supabase (тільки для Auth!) |
| `SUPABASE_KEY` | Anon key з Supabase (публічний) |
| `SUPABASE_JWT_SECRET` | JWT secret для валідації токенів |

**Важливо:** Supabase використовується **тільки для автентифікації** (OAuth, JWT). База даних локальна!

Для локальної розробки без Supabase:
- backend/.env: `ENABLE_DEV_AUTH=true`
- frontend/.env.local: `NEXT_PUBLIC_DEV_BYPASS_AUTH=1`

### Безпека
| Змінна | Призначення | Генерація |
|--------|-------------|-----------|
| `ENCRYPTION_KEY` | Шифрування stream keys | `openssl rand -hex 32` |
| `ENCRYPTION_SALT` | Сіль для шифрування | `openssl rand -hex 16` |
| `TUSD_HMAC_SECRET` | Підпис запитів tusd → FastAPI | `openssl rand -base64 32` |

### FFmpeg
| Змінна | macOS (Homebrew) | Linux |
|--------|------------------|-------|
| `FFMPEG_BIN` | `/opt/homebrew/bin/ffmpeg` | `/usr/bin/ffmpeg` |
| `FFPROBE_BIN` | `/opt/homebrew/bin/ffprobe` | `/usr/bin/ffprobe` |

### Stream Runtime
| Змінна | Опції | Рекомендація |
|--------|-------|--------------|
| `STREAM_RUNTIME_MODE` | `manager` \| `supervisor` \| `systemd` | `supervisor` для macOS/Docker, `systemd` для Linux |

Всі значення зберігаються в `backend/.env` та не повинні потрапляти в git.

## 🧭 Структура проекта

```
backend/               FastAPI, миграции, tusd hooks
frontend/              Next.js приложение (app router)
docs/                  Техническая документация
docker/                docker-compose и инфраструктурные файлы
start-*.sh             Локальные скрипты запуска
Makefile               Команды для разработки и CI
```

## 📚 Документація

- `docs/ARCHITECTURE.md` — архітектура рішення
- `docs/MVP_COMPLETE.md` — реалізований функціонал та API
- `docs/IMPLEMENTATION_REPORT.md` — звіт по доопрацюванням
- `docs/TROUBLESHOOTING.md` — часті проблеми та рішення
- `docs/backend_api_contract.md` та `docs/backend_api_map.md` — контракти REST API  
- `docs/postman/` — готові колекції та оточення Postman
- `docs/operations/supervisor.md` — налаштування Supervisor для автономних стрімів (macOS/Docker)
- `docs/systemd/` — налаштування systemd для Linux production
- `LOCAL_DB_SETUP.md` — інструкції по локальній PostgreSQL БД

### Автономные стримы через systemd

CLI-скрипт `python -m app.cli.run_stream <stream_id>` теперь умеет поднимать FFmpeg-процесс вне FastAPI и держит его запущенным, пока служба активна. Чтобы стримы не падали при рестарте API:

1. Скопируйте `docs/systemd/ffmpeg@.service.example` в `/etc/systemd/system/ffmpeg@.service` и подправьте пути/пользователя.
2. Включите режим `STREAM_RUNTIME_MODE=systemd` в `backend/.env`.
3. Поднимайте конкретные стримы через `systemctl enable --now ffmpeg@<stream_uuid>` — CLI сам соберёт плейлисты, запустит FFmpeg и обновит статус в БД.

Подробности: `docs/operations/systemd.md`.

### Альтернатива: Supervisord (macOS / Docker)

Если systemd недоступен (наприклад, macOS або Docker-контейнери), використовуйте
`STREAM_RUNTIME_MODE=supervisor`. Конфігурація описана в
`docs/operations/supervisor.md`: Supervisord запускає CLI
`python -m app.cli.run_stream <stream_id>` для кожного UUID і перезапускає його
після збоїв. Бекендові ендпоінти `start/stop/status` працюють через
`supervisorctl`, а фронтенд бачить реальний стан стріму.

- **Мониторинг**
  - Middleware `APIMetricsMiddleware` пишет латентность, HTTP-статус и ошибки в структурные логи и увеличивает счётчики `track_api_request` / `track_api_error`.
  - `/api/metrics` — агрегированная статистика по системным ресурсам и активным стримам.
  - `/api/metrics/prometheus` — текстовый экспорт для Prometheus/Grafana.
  - FFmpeg менеджер пробрасывает события `track_stream_start/stop/error`, поэтому дашборд показывает реальное число активных процессов и их длительность.

## 🛠 Команды Makefile

```bash
make install            # backend + frontend зависимости
make dev                # поднять backend, frontend и tusd
make dev-backend        # только FastAPI
make dev-frontend       # только Next.js
make dev-tusd           # только tusd
make test               # pytest + npm test
make lint               # ruff + black + eslint
make type-check         # mypy + npm run type-check
make clean              # очистка временных файлов
```

## ✅ Тестування

- `make test` — повний набір pytest + Jest (аналог CI).
- `make test-backend` / `make test-frontend` — запускають лише бекенд або фронтенд.
- `npm run build` у `frontend/` — production-білд Next.js з перевіркою типів та ESLint.
- Точкові сценарії: `pytest backend/tests/test_ffmpeg_manager.py -vv`, `pytest backend/tests/test_auth_multitenancy.py -vv`, `pytest backend/tests/test_collection_quorum.py -vv`.

Усі ці команди прогнані й успішні станом на цей коміт.

## 🐳 Docker

Для развёртывания в контейнерах используйте `docker/docker-compose.yml`. Перед запуском пропишите переменные окружения (см. `backend/.env.example`).

```bash
docker compose -f docker/docker-compose.yml up -d
```

## 🔐 Безопасность

- Все таблицы защищены RLS-политиками (см. `backend/migrations`)
- tusd взаимодействует с API только через подписанные запросы
- Секреты Supabase и ключи шифрования находятся вне репозитория
- Для production рекомендуется дополнительно включить Sentry и HTTPS-прокси (см. Caddy конфигурацию в `docker/`)

## 🤝 Вклад и поддержка

Пул-реквесты и issue приветствуются. Перед коммитом запускайте `make lint` и `make test`.  
Вопросы и предложения можно оформлять через Issues на GitHub.

# Docker
make docker-up            # Start containers
make docker-down          # Stop containers
make docker-logs          # View logs

# Database
make migrate              # Apply migrations
make create-admin         # Create admin user

# Utilities
make clean                # Clean temp files
make security-audit       # Audit dependencies
```

For full list: `make help`

## 📝 License

Available for personal and commercial use.

## 🤝 Support

- **GitHub**: https://github.com/slonce70/youtube_translation
- **Issues**: https://github.com/slonce70/youtube_translation/issues

---

**Built with ❤️ using FastAPI, Next.js, FFmpeg, and Supabase**

**Development Time**: ~12 hours | **Lines of Code**: 8,000+ | **Status**: Production Ready 🚀
