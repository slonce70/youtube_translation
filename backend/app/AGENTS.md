# Backend app-код (`backend/app/`) — JIT правила

## Ключова ідея
- Роут → схема → сервіс → (за потреби) модель → тест. Мінімізуй “business logic” всередині роутів.

## Де що знаходиться
- Вхід у застосунок/підключення роутів: `backend/app/main.py`
- Роутери: `backend/app/api/routes/*.py`
- Dependency injection (auth/db/user): `backend/app/api/deps.py`
- Сервіси (доменна логіка): `backend/app/services/**`
- Моделі БД (SQLAlchemy): `backend/app/models/**`
- Схеми (Pydantic): `backend/app/schemas/**`
- Налаштування/БД/квоти/безпека: `backend/app/core/**`
- Streaming (FFmpeg менеджер, інтеграції supervisor): `backend/app/streaming/**`

## Як додати новий API endpoint (швидко)
1. Додай/розшир роутер у `backend/app/api/routes/*.py` (використовуй `APIRouter`).
2. Винеси доменну логіку у відповідний модуль `backend/app/services/**`.
3. Додай/онови Pydantic-схеми у `backend/app/schemas/**`.
4. Підключи роутер у `backend/app/main.py` (імпорт + `app.include_router(...)`).
5. Додай тест у `backend/tests/**` (async fixtures, `pytest-asyncio`).

## Конвенції для БД (async SQLAlchemy)
- Сесію/фабрику брати з `backend/app/core/database.py` (не створювати “свої” engine/sessionmaker).
- Для запитів/транзакцій використовувати `async with ...` та `await`.

## Логи/метрики
- Логи: `backend/app/core/logging_config.py`
- Метрики: `backend/app/core/metrics.py` та роут `backend/app/api/routes/metrics.py`

## JIT-пошук
- Де підключено роут: `rg -n 'include_router\(' backend/app/main.py`
- Де залежності на auth/user: `rg -n 'get_current_user|get_db' backend/app/api`
- Де фонова задача/планувальник: `rg -n 'schedule_background_task|create_task\(' backend/app`
