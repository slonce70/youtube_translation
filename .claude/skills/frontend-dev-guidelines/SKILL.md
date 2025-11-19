---
name: frontend-dev-guidelines
description: Frontend development guidelines for youtube_translation (Next.js 15 App Router, React 19, Tailwind CSS, React Query, i18n). Use when створюєш або змінюєш сторінки, компоненти, хуки чи i18n.
---

# Frontend Development Guidelines (youtube_translation)

## Purpose

Надати єдиний набір патернів для Next.js 15 + React 19 фронтенду youtube_translation: App Router, Tailwind, React Query, i18n, компоненти `src/components/ui/*`.

## When to Use This Skill

- Створюєш нові сторінки в `frontend/src/app/**` (dashboard, admin, login тощо).
- Додаєш або змінюєш компоненти в `frontend/src/components/**`.
- Пишеш/оновлюєш хуки чи утиліти в `frontend/src/lib/**`.
- Працюєш з i18n (`frontend/src/messages/**`, `i18n.ts`).
- Оптимізуєш продуктивність або UX (loading/error‑стани, навігація).

---

## Quick Start

### New Component Checklist (youtube_translation)

- [ ] Виріши, чи це **Server Component** чи **Client Component** (якщо потрібні hooks, state, ефекти → client).
- [ ] Для UI використовуй Tailwind класи + спільні UI компоненти (`src/components/ui/*`).
- [ ] Чітко типізуй props (`type Props = { ... }`).
- [ ] Якщо компонент важкий/використовується рідко — lazy‑load через `dynamic()` або `React.lazy`.
- [ ] Тести: для важливих компонентів додай або онови тести в `__tests__` (див. існуючі).

### New Page / Route Checklist (App Router)

- [ ] Файл сторінки → `frontend/src/app/<route>/page.tsx`.
- [ ] Для layout’ів використовуй `layout.tsx`, для SEO — `metadata.ts`.
- [ ] Якщо потрібен лише датa‑fetch → розглянь Server Component.
- [ ] Якщо потрібен інтерактив/React Query — роби Client Component + hook із `src/lib`.
---

## Common Imports Cheatsheet (youtube_translation)

```ts
// React / Next
import * as React from 'react';
import type { ReactNode } from 'react';

// Next App Router
import Link from 'next/link';
import { notFound } from 'next/navigation';

// UI компоненти
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

// Data / React Query
import { useQuery } from '@tanstack/react-query';

// Локальні утиліти
import { api } from '@/lib/api';
import type { Plan } from '@/lib/types';
```

---

## Topic Guides

### 🎨 Component Patterns

- Віддавай перевагу дрібним, перевикористовним компонентам (`src/components/*`).
- Для загального UI (кнопки, інпути, бейджі) — використовуй `src/components/ui/*`.
- Tailwind класи тримай в межах розумної довжини; для складних layout’ів краще винести під‑компонент.
- Чітко поділяй компоненти "контейнер" (отримує дані) та "презентаційні" (рендерять UI).

---

### 📊 Data Fetching

- В youtube_translation використовується власний `api` клієнт (`src/lib/api.ts`) + React Query.
- Для клієнтських сторінок (dashboard, admin) — створюй кастомні хуки в `src/app/**/hooks` або `src/lib/` і використовуй `useQuery` / `useMutation`.
- Для простих read‑only сторінок розглядай використання Server Components + fetch на сервері.

---

### 📁 File Organization

- В youtube_translation структура вже задана (див. `frontend/README.md`).
- Новий функціонал для dashboard/admin краще групувати в окремі піддиректорії `src/app/dashboard/...`, `src/app/admin/...` з локальними компонентами/хуками.

---

### 🎨 Styling (Tailwind)

- Використовуй Tailwind класи для layout’ів (`flex`, `grid`, spacing, typography).
- Старайся не дублювати однакові набори класів — винеси їх у компонент.
- Для глобальних стилів/темізацій використовується `globals.css` та Tailwind config.

---

### 🛣️ Routing (Next.js App Router)

- Кожен маршрут — це папка в `src/app`, наприклад: `src/app/dashboard/page.tsx`.
- Використовуй `layout.tsx` для спільного layout’у та `metadata.ts` для SEO.
- Для API‑health чеків — `src/app/api/health/route.ts` (уже реалізовано; орієнтуйся на нього як на шаблон).

---

### ⏳ Loading & Error States

- Використовуй спільні компоненти `LoadingState`, `ErrorBoundary`, `QuotaWidget` тощо.
- Не змінюй різко layout між станами (loading/error/success) — краще показувати skeleton/placeholder.
- Для React Query покидай `isLoading` / `isError` в компонентах верхнього рівня, не глибоко всередині дерева.

---

### ⚡ Performance

- Використовуй `useMemo`/`useCallback` лише там, де це реально дає профіт (часто оновлювані списки, великі таблиці).
- Перед оптимізацією — подивись на існуючі патерни в тестах/компонентах dashboard/admin.

---

### 📘 TypeScript

- Тримай strict typing; по можливості уникай `any`.
- Використовуй `type`/`interface` для props і доменних моделей (`src/lib/types.ts`).

---

### 🔧 Common Patterns

- i18n: усі user‑visible рядки мають жити в `src/messages/**`;
- Auth: використання Supabase клієнта (`lib/supabase.ts`) і відповідних хук‑тестів;
- API: всі запити через `lib/api.ts`, не напряму `fetch`.

---

### 📚 Complete Examples

Використовуй існуючий код як приклади:
- landing‑сторінки в `src/components/landing/*`;
- dashboard‑сторінки в `src/app/dashboard/**`;
- admin‑сторінки в `src/app/admin/**`;
- тестові файли в `src/components/__tests__` та `src/app/**/__tests__`.

---

## Navigation / Examples

- Для огляду архітектури та CLI/запуску дивись `frontend/README.md`.
- За прикладами тестів — `src/components/__tests__` та `src/app/**/__tests__`.
- За прикладами складних сторінок — `src/app/dashboard/**` та `src/app/admin/**`.

---

## Related Skills

- **backend-dev-guidelines** — патерни побудови API, які споживає frontend.
- **error-tracking** — якщо буде додана Sentry інтеграція на фронті.

---

**Skill Status**: ADAPTED for youtube_translation ✅