# CRM-14 Delivery Plan And Sequencing

## Delivery Objective

Поточна хвиля для `youtube_translation` має один release target: провести перший успішний локальний rehearsal стріму без ручних обхідних шляхів.

Definition of done для цієї хвилі:

- стабільний hybrid boot для `postgres`, `redis`, `tusd`, `runner` і локальних backend/frontend
- зелений базовий quality bar: `make lint`, `make test`, `curl http://localhost:8000/health`
- один успішний локальний прогін за `docs/operations/first_stream_checklist.md`
- узгоджений QA smoke gate і зафіксоване CEO go/no-go рішення

## Current Picture

- У репозиторії вже є великий active WIP по runtime, backend API/schema, dashboard/library, landing і docs.
- Поточний execution mode це stabilization wave, а не greenfield implementation.
- Паралельні входи вже запущені:
  - research brief: [CRM-13](/CRM/issues/CRM-13)
  - QA baseline and release gate: [CRM-15](/CRM/issues/CRM-15)

## Workstreams

### 1. Runtime + Backend Stabilization

Scope:

- runtime/bootstrap path: `start-backend.sh`, `start-tusd.sh`, `Makefile`, supervisor/runner config
- env contract, migrations, dependency checks
- rehearsal-critical backend slices: `streams`, `assets`, `metrics`, websocket/auth/runtime compatibility

Exit criteria:

- локальний baseline піднімається прогнозовано
- прибрано runtime/schema/env drift
- backend достатньо стабільний для QA smoke і frontend alignment

Execution issue:

- [CRM-18](/CRM/issues/CRM-18)

### 2. Frontend Operator Alignment

Scope:

- dashboard/library/operator flows поверх поточного backend surface
- stream socket/live status alignment
- auth toggles, i18n і docs sync лише там, де це блокує rehearsal path

Exit criteria:

- проходять `npm test`, `npm run type-check`, `npm run i18n:check`
- operator flows узгоджені для локального rehearsal
- UI-only polish не блокує merge

Execution issue:

- [CRM-19](/CRM/issues/CRM-19)

### 3. Release Readiness

Scope:

- smoke gate і regression matrix з [CRM-15](/CRM/issues/CRM-15)
- incorporation research constraints з [CRM-13](/CRM/issues/CRM-13)
- first-stream rehearsal і release memo

Exit criteria:

- є чіткий smoke gate перед merge/release
- rehearsal path проходить end-to-end
- CEO має короткий decision memo по релізу

## Sequencing

### Wave 0. Lock Target And Owners

- release target на цю хвилю: тільки first successful local stream rehearsal
- ownership:
  - Founding Engineer: implementation owner для [CRM-18](/CRM/issues/CRM-18) і [CRM-19](/CRM/issues/CRM-19)
  - QA Engineer: quality gate і verification через [CRM-15](/CRM/issues/CRM-15)
  - Researcher: next-wave constraints і recommendations через [CRM-13](/CRM/issues/CRM-13)
  - Program Manager: cross-stream sequencing, status synthesis, escalation

### Wave 1. Close Runtime Baseline

- завершити runtime/backend stabilization у [CRM-18](/CRM/issues/CRM-18)
- не розширювати scope у YouTube next-wave, поки baseline не зелений

### Wave 2. Align Frontend To Stable Backend

- стартувати [CRM-19](/CRM/issues/CRM-19) після green baseline з [CRM-18](/CRM/issues/CRM-18)
- тримати frontend slice rehearsal-critical, не змішувати з broad polish

### Wave 3. Rehearsal Gate

- поглинути outputs з [CRM-13](/CRM/issues/CRM-13) і [CRM-15](/CRM/issues/CRM-15)
- пройти `docs/operations/first_stream_checklist.md`
- зафіксувати RC або no-go рішення

## Critical Path

1. Runtime/bootstrap stability
2. Backend compatibility for rehearsal-critical flows
3. Frontend dashboard/operator alignment
4. QA smoke gate plus first-stream rehearsal

## Risks

- Один implementation owner на двох execution slices знижує parallelism, але прибирає ambiguity і дає чіткий порядок роботи.
- Великий незакомічений diff означає, що потрібно працювати вузькими mergeable slices.
- Research і QA outputs не мають роздувати rehearsal-critical path без окремого CEO рішення.

## Release Checkpoints

1. Baseline green: `make lint`, `make test`, `/health`
2. Runtime rehearsal: один локальний стрім проходить чекліст
3. QA gate: smoke suite і regression matrix з [CRM-15](/CRM/issues/CRM-15)
4. Scope gate: recommendations з [CRM-13](/CRM/issues/CRM-13) або прийняті, або свідомо відкладені
5. CEO sign-off на merge/release order

## Cadence

- Щоденний async update від кожного owner по прогресу, блокерах і next step
- Program Manager зводить cross-stream status і піднімає escalation, якщо `CRM-18` або `CRM-15` зупиняються
- Merge policy: runtime/backend slices важливіші за frontend polish; UI-only перемоги не рахуються як release readiness
