# Журнал робіт

## 2026-01-08
- Виніс supervisord у окремий Docker-сервіс `runner` і підключив shared socket/volumes.
- Оновив `supervisord.conf` під shared UNIX socket (`/app/supervisord/supervisor.sock`).
- Описав runner в `docs/ARCHITECTURE.md` і оновив схему.

## 2025-12-30
- Посилив безпеку: Supabase SSR сесії, токени WS, CSP заголовки, tusd hooks з fail-open контролем.
- Додав Redis-опційний rate limiting, FFmpeg exponential backoff, shuffle seed mode.
- Виніс логіку streaming UI у компоненти та зробив async читання логів стріму.
- Додав e2e тести (landing/login, upload token, start/stop stream, live-edit) з mock API.
- Додав алерти/метрики (disk warning thresholds, Sentry alerts для tusd/quota/ffmpeg).
- Тести пройдені: backend pytest, frontend jest, e2e Playwright.
