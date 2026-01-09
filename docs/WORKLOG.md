# Журнал робіт

## 2026-01-09
- Виправив падіння `GET /api/streams/` (lazy-load у async) — додано eager-load `stream_destinations → destination`, через що список трансляцій стабільно відображається без “перезавантажень” сторінки.
- Додав міграцію `026_collection_items_updated_at.sql` для сумісності старих локальних БД (колонка `collection_items.updated_at` + trigger). Оновив `backend/apply_migrations.py`.
- Полагодив UX останнього кроку створення трансляції: модалка `StreamBuilder` тепер скролиться і кнопка підтвердження не “ховається” під екран.
- Поліпшив UX після завантаження файлів: Library робить довший refetch (backoff) і показує щойно завантажений файл без ручного refresh сторінки.
- Вирівняв Docker runner: прибрав застарілий `version` з compose, додав окремий healthcheck для `runner` (бо образ успадковував backend healthcheck на `:8000`), підтвердив роботу з `supervisord.docker.conf` через `runner:9001` (Docker Desktop/macOS-friendly).
- Усунув зависання статусу `stopping`: reconciler тепер обробляє `stopping` (startup + periodic sync), а supervisor parse коректно розпізнає `NOT_FOUND`, щоб не лишати DB у `UNKNOWN`.
- Поліпшив логи стрімів: `mode=important` за замовчуванням + перемикач “показати всі” у UI; лише `error` підсвічується червоним, решта — сірим. Також зменшив FFmpeg spam (`-hide_banner -nostats`) і відфільтрував прогрес‑рядки.
- Library: виправив запис `thumbnail_url` (JSONB mutation tracking) + додав fallback прев’ю `/thumbnails/{asset_id}.jpg`, щоб відео не показувало “порожній квадрат”.
- Оновив рекомендації bitrate/quality (включно з 720p та підтримкою дробних значень на кшталт `4.5 Mbps`).
- i18n: додав ключі та переклади (uk/en/ru) для timeline/logs у streaming builder, прибрав частину hardcoded рядків.
- Підтвердив тестами: `cd backend && python -m pytest` (115 passed, 8 skipped).

## 2026-01-08
- Виніс supervisord у окремий Docker-сервіс `runner` і підключив shared socket/volumes.
- Оновив `supervisord.conf` під shared UNIX socket (`/app/supervisord/supervisor.sock`).
- Описав runner в `docs/ARCHITECTURE.md` і оновив схему.
- Додав stop‑scheduler (one‑shot) з новими полями `scheduled_stop_*` та UI для stop time.
- Додав збереження timezone користувача (`user_profiles.timezone`) через заголовок `X-User-Timezone` (для коректного UI scheduler).
- Зробив safe delete для Library UI: при 409 показуємо залежності й не даємо force delete.

## 2025-12-30
- Посилив безпеку: Supabase SSR сесії, токени WS, CSP заголовки, tusd hooks з fail-open контролем.
- Додав Redis-опційний rate limiting, FFmpeg exponential backoff, shuffle seed mode.
- Виніс логіку streaming UI у компоненти та зробив async читання логів стріму.
- Додав e2e тести (landing/login, upload token, start/stop stream, live-edit) з mock API.
- Додав алерти/метрики (disk warning thresholds, Sentry alerts для tusd/quota/ffmpeg).
- Тести пройдені: backend pytest, frontend jest, e2e Playwright.
