# Frontend source (`frontend/src/`) — JIT правила

## Ключова ідея
- App Router (`src/app/**`) керує сторінками/лейаутами, а `src/components/**` — перевикористовувані UI блоки.

## Де що знаходиться
- Головний лейаут/провайдери: `frontend/src/app/layout.tsx`, `frontend/src/app/providers.tsx`
- Сторінки: `frontend/src/app/**/page.tsx`
- Адмінка: `frontend/src/app/admin/**`
- Дашборд: `frontend/src/app/dashboard/**`
- Компоненти: `frontend/src/components/**`
- API/типи/утиліти: `frontend/src/lib/**`
- Локалізації: `frontend/src/messages/{uk,en,ru}/**`

## i18n (next-intl)
- Ключі/повідомлення: `frontend/src/messages/**`
- Перевірка синхронізації локалізацій: `cd frontend && npm run i18n:check`
- Для нових рядків: спочатку додай ключ у `uk`, потім заповни `en`/`ru`.

## Дані та запити
- Базовий API клієнт: `frontend/src/lib/api.ts`
- Для кешу/станів запитів: `@tanstack/react-query` (див. провайдер у `frontend/src/app/providers.tsx`).

## Тести
- Компоненти: `frontend/src/components/__tests__/`
- Lib/утиліти: `frontend/src/lib/__tests__/`

## JIT-пошук
- Де оголошено маршрут: `rg -n '^export default' frontend/src/app`
- Де використано i18n ключ: `rg -n 'useTranslations\(|t\(' frontend/src`
- Де використано React Query: `rg -n 'useQuery\(|useMutation\(' frontend/src`
