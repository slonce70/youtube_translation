# Frontend (Next.js) — правила для агентів

## Призначення
- Веб-панель (dashboard) на Next.js 15 + React 19, Tailwind, `next-intl` (i18n) та React Query.

## Запуск і розробка
- Встановити залежності: `make install-frontend` (або `cd frontend && npm install`)
- Запустити тільки фронтенд: `make dev-frontend` (або `cd frontend && npm run dev`)
- Перевірка i18n: `cd frontend && npm run i18n:check`

## Якість коду та тести
- Лінт: `cd frontend && npm run lint`
- TypeScript: `cd frontend && npm run type-check`
- Юніт-тести (Jest): `cd frontend && npm test`

## Структура (куди що класти)
- App Router сторінки/лейаути: `frontend/src/app/**`
- Компоненти: `frontend/src/components/**`
- Спільні утиліти/API/типи: `frontend/src/lib/**`
- Локалізації: `frontend/src/messages/{uk,en,ru}/**`
- Статика: `frontend/public/**`

## Патерни та конвенції
- Текст у UI брати з `next-intl`; за замовчуванням — українська.
- Для запитів до API: використовувати існуючий клієнт/обгортку в `frontend/src/lib/api.ts` та React Query.
- Компоненти: PascalCase, хуки/утиліти — camelCase; відступ 2 пробіли (ESLint/Prettier).
- Тримати UI атоми в `frontend/src/components/*`, не змішувати з бізнес-логікою.

## Тести
- Основний підхід: `@testing-library/react` + Jest.
- Тести зазвичай лежать у `frontend/src/components/__tests__/` та `frontend/src/lib/__tests__/`.

## JIT-підказки (пошук)
- Знайти сторінку/лейаут: `rg -n 'export default (async )?function' frontend/src/app`
- Знайти компонент: `rg -n 'export (default )?function|export const [A-Z]' frontend/src/components`
- Знайти виклик API: `rg -n '@/lib/api|api\.' frontend/src`
- Знайти переклад: `rg -n '"some.key"' frontend/src/messages`

## Поширені граблі
- Клієнтські компоненти мають містити `"use client"` (App Router).
- Змінні оточення для браузера повинні мати префікс `NEXT_PUBLIC_`.

## Перед PR (мінімум)
- `cd frontend && npm run lint && npm run type-check && npm test && npm run i18n:check`
