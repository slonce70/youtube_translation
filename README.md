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

## 🚀 Швидкий старт (локально)

### Канонічний локальний шлях: hybrid boot

Поточний рекомендований baseline для розробки:
- базові сервіси піднімаються через Docker Compose: `postgres`, `redis`, `tusd`, `runner`
- FastAPI та Next.js запускаються локально через `start-backend.sh` і `start-frontend.sh`
- для локального smoke/e2e шляху використовується **DEV auth**

### Передумови
- macOS або Linux
- Python 3.11+
- Node.js 18+
- Docker / Docker Compose
- FFmpeg (`/opt/homebrew/bin/ffmpeg` на Apple Silicon або `/usr/bin/ffmpeg` на Linux)

### Крок 1: Клонувати та встановити залежності

```bash
git clone https://github.com/slonce70/youtube_translation.git
cd youtube_translation

# Встановити залежності
make install

# Налаштувати конфігурацію
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# Відредагувати backend/.env:
# - DATABASE_URL (для локального hybrid boot вже вказує на localhost:5432)
# - SUPABASE_URL, SUPABASE_KEY, SUPABASE_JWT_SECRET (тільки для Auth, backend)
# - ENCRYPTION_KEY, ENCRYPTION_SALT (згенерувати: openssl rand -hex 32)
# - UPLOAD_TOKEN_SECRET (згенерувати: openssl rand -hex 32)
# - TUSD_HMAC_SECRET (згенерувати: openssl rand -base64 32)
# - FFMPEG_BIN=/opt/homebrew/bin/ffmpeg (для Apple Silicon)
# Для локальної розробки без Supabase:
# - ENABLE_DEV_AUTH=true
# - DEV_USER_EMAIL=dev@example.com
# - DEV_USER_ID=00000000-0000-0000-0000-000000000001
# Відредагувати frontend/.env.local:
# - NEXT_PUBLIC_DEV_BYPASS_AUTH=1
```

### Крок 2: Підняти базові сервіси

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis tusd runner
```

Ця команда піднімає локальну PostgreSQL, Redis, `tusd` та окремий `runner` для supervisor-based FFmpeg процесів.

### Крок 3: Обрати локальний auth path

- **Локальний smoke / e2e шлях:** `ENABLE_DEV_AUTH=true` у `backend/.env` та `NEXT_PUBLIC_DEV_BYPASS_AUTH=1` у `frontend/.env.local`
- **Продуктовий шлях:** Supabase Auth через `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_JWT_SECRET`

Supabase у цьому проєкті використовується лише для автентифікації. Дані застосунку живуть у PostgreSQL.

### Крок 4: Застосувати міграції БД

```bash
cd backend
python3 apply_migrations.py
```

### Крок 5: Запустити все

```bash
# З кореня репозиторію:
./start-backend.sh   # Backend:  http://localhost:8000
./start-frontend.sh  # Frontend: http://localhost:3000
```

Після старту базові поверхні для smoke повинні бути доступні тут:
- `http://localhost:8000/health`
- `http://localhost:8000/docs`
- `http://localhost:3000/`
- `http://localhost:3000/dashboard`
- `http://localhost:3000/admin`

### Runtime policy локально

- Бажаний локальний режим: `STREAM_RUNTIME_MODE=supervisor`
- `start-backend.sh` спочатку намагається використати вже запущений Docker `runner` через loopback endpoint `127.0.0.1:9001`, а supervisor control захищений паролем на базі `UPLOAD_TOKEN_SECRET`
- Якщо зовнішній supervisor недоступний і `supervisorctl` або `supervisord` відсутні, `start-backend.sh` автоматично переключає runtime на `manager`
- `systemd` лишається production/Linux-варіантом і не є канонічним локальним шляхом

Деталі:
- [docs/operations/supervisor.md](docs/operations/supervisor.md)
- [docs/operations/systemd.md](docs/operations/systemd.md)

### Перевірка baseline

```bash
# Перевірити backend health
curl http://localhost:8000/health

# Базова якість
make lint
make test

# Frontend e2e
cd frontend && npm run test:e2e
```

Після цього переходьте до [docs/operations/first_stream_checklist.md](docs/operations/first_stream_checklist.md), де зафіксовано визначення першого успішного стріму.

### Строгий V0 gate

Для стабілізаційного tranche і перед ручним rehearsal використовуйте один канонічний gate:

```bash
make verify-v0
```

Він включає:
- `RUN_BLACK=1 make lint`
- `RUN_MYPY=1 make type-check`
- `make i18n-check`
- `make test`
- `cd frontend && npm run build`
- `cd frontend && npm run test:e2e`

Це важливо, бо дефолтні `make lint` і `make type-check` самі по собі не вмикають backend `black --check` і `mypy`.

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
- Для smoke/e2e це рекомендований локальний шлях за замовчуванням

### Безпека
| Змінна | Призначення | Генерація |
|--------|-------------|-----------|
| `ENCRYPTION_KEY` | Шифрування stream keys | `openssl rand -hex 32` |
| `ENCRYPTION_SALT` | Сіль для шифрування | `openssl rand -hex 16` |
| `UPLOAD_TOKEN_SECRET` | Підпис токенів для tusd pre-create hook | `openssl rand -hex 32` |
| `TUSD_HMAC_SECRET` | Підпис запитів tusd → FastAPI | `openssl rand -base64 32` |
| `WS_TOKEN_SECRET` | Секрет для короткоживучих WS-токенів (fallback: `UPLOAD_TOKEN_SECRET`) | `openssl rand -hex 32` |
| `WS_TOKEN_TTL_SECONDS` | TTL для WS-токенів у секундах | `60` |
| `METRICS_ACCESS_TOKEN` | Спільний токен для доступу до `/api/metrics/prometheus` | `openssl rand -hex 16` |
| `TRUSTED_PROXY_IPS` | Довірені проксі IP/CIDR (для X-Forwarded-For) | `10.0.0.0/8,127.0.0.1` |
| `FORWARDED_ALLOW_IPS` | Довірені IP/CIDR для `X-Forwarded-*` на рівні Uvicorn; залиште порожнім, щоб використати `TRUSTED_PROXY_IPS` або приватні Docker bridge ranges | `127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` |
| `TUSD_FAIL_OPEN` | Дозволити upload при помилках backend (1=так, 0=ні) | `0` |

### FFmpeg
| Змінна | macOS (Homebrew) | Linux |
|--------|------------------|-------|
| `FFMPEG_BIN` | `/opt/homebrew/bin/ffmpeg` | `/usr/bin/ffmpeg` |
| `FFPROBE_BIN` | `/opt/homebrew/bin/ffprobe` | `/usr/bin/ffprobe` |

### Logging
| Змінна | Призначення | Приклад |
|--------|-------------|---------|
| `STREAM_LOG_MAX_BYTES` | Максимальний розмір stream.log перед ротацією | `52428800` |
| `STREAM_LOG_MAX_BACKUPS` | Кількість резервних логів | `5` |

### Stream Runtime
| Змінна | Опції | Рекомендація |
|--------|-------|--------------|
| `STREAM_RUNTIME_MODE` | `manager` \| `supervisor` \| `systemd` | `supervisor` для macOS/Docker, `systemd` для Linux |
| `STREAM_RUNTIME_NODE_ID` | Стабільний ідентифікатор runtime-вузла | hostname або явне ім'я ноди/worker-групи |
| `ALLOW_UNSAFE_MANAGER_RUNTIME` | `true` \| `false` | `false`; у `staging`/`production` manager runtime заборонений без явного override |
| `STREAM_RUNTIME_LEASE_TTL_SECONDS` | TTL DB lease для ownership стріму (сек) | `60`; має бути >= heartbeat interval |
| `STREAM_RUNTIME_HEARTBEAT_INTERVAL_SECONDS` | Інтервал heartbeat managed runner (сек) | `10` |
| `STREAM_RUNTIME_HEARTBEAT_TTL_SECONDS` | Через скільки heartbeat вважається застарілим (сек) | `45` |
| `STREAM_RUNTIME_AUTO_RESTART_ENABLED` | `true` \| `false` | `true`; backend-owned restart orchestration для supervisor/systemd |
| `STREAM_RUNTIME_RESTART_MAX_ATTEMPTS` | Кількість persistent retry після unexpected failure | `5` |
| `STREAM_RUNTIME_RESTART_BACKOFF_SECONDS` | Базовий exponential backoff (сек) | `5` |
| `STREAM_RUNTIME_RESTART_BACKOFF_MAX_SECONDS` | Максимальний backoff (сек) | `300` |
| `STREAM_RUNTIME_RESTART_JITTER_SECONDS` | Детермінований jitter між нодами (сек) | `3` |
| `STREAM_RUNTIME_RESTART_RESET_AFTER_SECONDS` | Після скількох секунд стабільної роботи retry budget обнуляється | `900` |
| `FFMPEG_OUTPUT_RECOVERY_MAX_ATTEMPTS` | Ліміт fifo-recovery для publish outputs; `0` залишає безлімітний budget FFmpeg | `0` |
| `MEDIAMTX_ENABLED` | `true` \| `false` | `false` за замовчуванням; увімкніть для optional media-plane summary |
| `MEDIAMTX_RTMP_PUBLISH_URL` | Internal RTMP relay URL | `rtmp://mediamtx:1935` |
| `MEDIAMTX_CONTROL_API_URL` | Control API URL | `http://mediamtx:9997` |
| `MEDIAMTX_METRICS_URL` | Prometheus metrics URL | `http://mediamtx:9998/metrics` |
| `FFMPEG_RESTART_BACKOFF_MAX_SECONDS` | Максимальна пауза між авто-реcтарти (сек) | `60` |
| `PLAYLIST_SHUFFLE_SEED_MODE` | `deterministic` \| `random` | `deterministic` |

### Rate limiting (optional)
| Змінна | Призначення | Приклад |
|--------|-------------|---------|
| `REDIS_URL` | Redis URL для distributed rate limiting | `redis://localhost:6379/0` |
| `REDIS_RATE_LIMIT_PREFIX` | Prefix для ключів лімітера | `rate-limit` |

Всі значення зберігаються в `backend/.env` та не повинні потрапляти в git.

## 🧭 Структура проекта

```
backend/               FastAPI, міграції, tusd hooks
frontend/              Next.js застосунок (app router)
docs/                  технічна документація
docker/                docker-compose та інфраструктурні файли
start-*.sh             локальні скрипти запуску
Makefile               команди для розробки та CI
```

## 📚 Документація

- `docs/ARCHITECTURE.md` — архітектура рішення
- `docs/TESTING.md` — канонічний локальний bootstrap і перевірки
- `docs/MVP_COMPLETE.md` — реалізований функціонал та API
- `docs/IMPLEMENTATION_REPORT.md` — звіт по доопрацюванням
- `docs/TROUBLESHOOTING.md` — часті проблеми та рішення
- `docs/backend_api_contract.md` та `docs/backend_api_map.md` — контракти REST API  
- `docs/postman/` — готові колекції та оточення Postman
- `docs/operations/first_stream_checklist.md` — чекліст і визначення першого успішного стріму
- `docs/operations/supervisor.md` — налаштування Supervisor для автономних стрімів (macOS/Docker)
- `docs/operations/systemd.md` — налаштування systemd для Linux production
- `docs/operations/mediamtx.md` — optional MediaMTX relay/metrics layer для майбутнього scale-up
- `docs/design/README.md` — archived standalone mockups і design reference assets, які не входять у shipping baseline
- `LOCAL_DB_SETUP.md` — інструкції по локальній PostgreSQL БД

### Автономні стріми через systemd

CLI-скрипт `python -m app.cli.run_stream <stream_id>` може піднімати FFmpeg-процес поза FastAPI й тримати його активним, поки працює systemd-служба. Це production/Linux-сценарій, а не канонічний локальний baseline.

1. Скопіюйте `docs/systemd/ffmpeg@.service.example` у `/etc/systemd/system/ffmpeg@.service` і підправте шляхи/користувача.
2. Увімкніть `STREAM_RUNTIME_MODE=systemd` у `backend/.env`.
3. Піднімайте конкретні стріми через `systemctl enable --now ffmpeg@<stream_uuid>` — CLI сам збере плейлисти, запустить FFmpeg і оновить статус у БД.

Подробиці: `docs/operations/systemd.md`.

### Альтернатива: Supervisord (macOS / Docker)

Якщо `systemd` недоступний, використовуйте `STREAM_RUNTIME_MODE=supervisor`. Саме цей режим є цільовим для macOS/Docker. Якщо `supervisorctl` або `supervisord` відсутні, локальний стартовий скрипт у `development` може перейти в `manager` fallback; у `staging`/`production` цей fallback заблокований, якщо ви явно не задали `ALLOW_UNSAFE_MANAGER_RUNTIME=true`. Managed runner пише heartbeat у shared `backend/streams/.runtime-heartbeats/`, а backend паралельно тримає DB lease (`runtime_owner_id`, `runtime_lease_expires_at`) для multi-worker/multi-node safety. Поверх цього backend веде persistent restart state (`runtime_restart_attempts`, `runtime_next_restart_at`, `runtime_last_failure_at`, `runtime_last_restart_at`) і сам orchestrat-ить retry/backoff для supervisor/systemd після unexpected failure або stale heartbeat. Для наступного етапу вже підготовлений optional MediaMTX layer: `make dev-bootstrap-v2` піднімає relay/metrics service, а `/api/metrics` вміє повертати `media_plane.mediamtx` summary разом з `active_paths`, якщо `MEDIAMTX_ENABLED=true`. Деталі винесені в `docs/operations/supervisor.md` і `docs/operations/mediamtx.md`.

### Моніторинг

- Middleware `APIMetricsMiddleware` пише латентність, HTTP-статус і помилки в структурні логи та збільшує лічильники `track_api_request` / `track_api_error`.
- `/api/metrics` — агрегована статистика по системних ресурсах і активних стрімах.
- `/api/metrics/prometheus` — текстовий експорт для Prometheus/Grafana.
- FFmpeg manager передає події `track_stream_start/stop/error`, тому дашборд показує реальну кількість активних процесів і їхню тривалість.

## 🛠 Команды Makefile

```bash
make install            # backend + frontend зависимости
make dev                # поднять backend, frontend и tusd
make dev-backend        # только FastAPI
make dev-frontend       # только Next.js
make dev-tusd           # только tusd
make test               # pytest + npm test
make lint               # ruff + eslint (Black only with RUN_BLACK=1)
make type-check         # frontend tsc + optional backend mypy
make verify-v0          # строгий V0 gate: black + mypy + tests + build + e2e
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
