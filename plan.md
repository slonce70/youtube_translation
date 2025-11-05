# План развития проекта

## 1. Критические задачи (выполнить в первую очередь)
- [x] **Фронтенд‑тесты**  
  - [x] Подключить Jest + React Testing Library  
  - [x] Написать smoke‑тесты для ключевых компонентов и страниц (`dashboard`, `admin`)  
  - [x] Добавить интеграционные тесты для `api` клиента  
- [x] **Допилить Supabase auth API (app/api/routes/auth.py)**  
  - [x] Реализовать login/logout/get_user  
  - [x] Покрыть тестами happy/edge cases  
- [x] **Валидация плейлистов перед запуском стрима**  
  - [x] Использовать `PlaylistBuilder.validate_playlist_assets()` в отдельном эндпоинте  
  - [x] Возвращать подробные ошибки фронтенду  
- [x] **Уточнить rate limiting**  
  - [x] Настроить разные лимиты для чувствительных роутов (`/streams/start`, `/assets/upload-complete`, admin API)  
- [x] **FFmpeg monitoring**  
  - [x] Добавить уведомления/alerts при падении процесса  
  - [x] Реализовать auto‑restart и логирование причины  

## 2. Высокий приоритет
- **CI/CD (GitHub Actions)**  
  - lint (backend/frontend), pytest, будущие Jest тесты  
  - mypy + type check  
  - docker build / security audit  
- **Sentry / Observability**  
  - Настроить Sentry DSN, базовые алерты  
  - Экспорт /metrics (Prometheus) + healthchecks для docker  
- **Кэш пользователей в deps.py**  
  - Перейти на `asyncio.Lock`, убрать `threading.RLock`  
- **Документация API**  
  - Развернутые docstrings для эндпоинтов, OpenAPI tags  
  - Актуализировать Postman коллекцию  
- **Frontend: управление тарифом в админке**  
  - Добавить UI для `changeTier` + подтверждение действия  

## 3. Средний приоритет
- **Дополнительные тесты backend**  
  - ffmpeg manager, quota enforcer, security (расширить существующие)  
- **Structured logging**  
  - Передавать контекст (user_id, stream_id) во все вызовы logger  
- **CORS и конфигурация среды**  
  - Строгий whitelist из ENV  
  - Вынести hardcoded лимиты/константы в настройки  
- **Переиспользование PlaylistItem.asset**  
  - При необходимости добрать `selectinload(Playlist.items).selectinload(PlaylistItem.asset)`  
- **Подготовить CONTRIBUTING.md и troubleshooting**  

## 4. Низкий приоритет / долгосрочно
- Docker оптимизации (cache mounts, dev/prod образы)  
- Redis / CDN / caching layer  
- OpenTelemetry, распределённый трейсинг  
- E2E тесты (Playwright/Cypress)  
- Структурная реорганизация каталогов (domain/infrastructure) – по необходимости  

> План можно использовать как чек‑лист для следующих спринтов; по мере выполнения задач обновлять статусы и добавлять новые пункты.
