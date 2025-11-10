# Звіт про стан платформи

## Ключові оновлення
- **FFmpeg менеджер**: усі режими (video/audio/mixed) володіють телеметрією `FFmpegCommandPlan`, подіями `track_stream_start/stop/error` та авто-очищенням стану (`cleanup_ffmpeg_streams`). Гарячий перезапуск (`restart_stream`) зберігає дестинації, логи та маркує `hot_swap` у метаданих.
- **Медіа-бібліотека**: бекенд фільтрує `/api/assets` за типом і папкою з перевірками прав доступу; UI має drag&drop, пакетні дії, попередження про використання та форс-видалення з автодективацією спорожнілих колекцій.
- **Колекції та папки**: додані міграції й ORM-моделі `media_folders`, `media_collections`, `collection_items`; при видаленні останнього asset-а колекція стає неактивною та створює `SystemAlert`.
- **Квоти та процесинг tusd**: `QuotaEnforcer` працює на створенні/видаленні, `_apply_storage_delta` підтримує точне значення `current_storage_bytes` для UI.
- **Спостережуваність**: `APIMetricsMiddleware` логгує кожен HTTP-запит і живить Prometheus-ендпоінт `/api/metrics/prometheus`; README описує новий стек моніторингу.
- **Frontend**: конструктор стрімів використовує тестовані `builder-helpers`, а бібліотека — `asset-utils`. Додані Jest-тести для обох модулів, а також smoke-тести локалізації.

## Документація
- `README.md`: інструкції з деплою, моніторингу та новий розділ «Тестування». 
- `docs/architecture.md`: описано Observability-пайплайн (JSON-логи, Prometheus endpoint, UI-хуки).
- `plan.md`: усі фази (0–6) позначені як виконані; список завдань збережено для історії.

## Тестування та білд
- `make test` (pytest + Jest) — **PASS**.
- `npm run build` у `frontend/` — **PASS** (Next.js 15.5.6, перевірка типів і ESLint).
- Цільові pytest-сценарії (`test_ffmpeg_manager.py`, `test_auth_multitenancy.py`, `test_collection_quorum.py`, `test_assets_api.py`) — **PASS**.

Станом на цей коміт код збирається без помилок, тести зелені, документація та план актуальні.
