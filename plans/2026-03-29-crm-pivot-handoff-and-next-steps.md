# CRM Pivot Handoff And Next Steps

## Навіщо цей артефакт

Зафіксувати фактичний стан після board decision по `youtube_translation` і не втратити engineering momentum для CRM-напряму.

## Підтверджений Paperclip стан

- Board decision: [CRM-20](/CRM/issues/CRM-20) завершив програму `youtube_translation` з формулюванням "тільки CRM".
- Execution slices [CRM-18](/CRM/issues/CRM-18) і [CRM-19](/CRM/issues/CRM-19) скасовані до завершення.
- На момент цього handoff у Founding Engineer немає активних `todo` / `in_progress` / `blocked` assignment'ів.
- [CRM-11](/CRM/issues/CRM-11) лишається в `backlog`; його не варто стартувати без окремого рішення CEO/board, бо це AI slice поверх ще не активованого CRM pilot contour.

## Локальний технічний стан workspace

У поточному repo лишився великий незавершений diff з попереднього напрямку:

- `94` змінених paths
- основні зони: `frontend` (`42`), `backend` (`34`), `docs` (`8`)
- за `git diff --stat` уже є щонайменше `78` tracked-файлів зі змінами, приблизно `2802` insertion'ів і `1124` deletion'ів

Практичний висновок:

- це не чистий CRM workspace
- тут є значний `youtube_translation`-specific WIP
- починати нову CRM-реалізацію в цьому ж diff небезпечно: змішаються дві різні продуктові лінії, втратиться audit trail і зросте ризик випадково перенести зайвий код

## Що валідно з попередньої роботи

Попередні CRM-артефакти Paperclip лишаються корисними як direction-setting input:

- [CRM-4](/CRM/issues/CRM-4): технічний blueprint MVP CRM
- [CRM-5](/CRM/issues/CRM-5): delivery foundation / implementation slice
- [CRM-6](/CRM/issues/CRM-6): core domain і модульна декомпозиція
- [CRM-10](/CRM/issues/CRM-10): pilot contour

Натомість execution plan для `youtube_translation` в [CRM-14](/CRM/issues/CRM-14#document-plan) тепер історичний і не повинен бути основою для нових engineering task'ів.

## Архітектурна позиція на наступний крок

Для MVP CRM під українські маркетплейси треба відновити delivery не з цього WIP, а з чистого CRM execution lane:

1. Окремий canonical workspace/repo або чітко зафіксований підкаталог для CRM.
2. Новий execution plan, який спирається на CRM blueprint, а не на streaming/rehearsal flow.
3. Вузький pilot contour:
   - `ROZETKA` як first commercial channel
   - `Prom` як beta/second channel
   - core operator flow: order inbox -> customer context -> manual action -> status sync
4. AI slice тримати поза critical path до стабілізації core pilot.

## Рекомендований sequencing

### Wave 0. Freeze And Isolate

Перед будь-яким новим CRM coding треба вирішити долю цього workspace:

- або archive/freeze поточний `youtube_translation` diff окремою гілкою/patch artifact
- або явним рішенням board дозволити cherry-pick лише reusable технічних шматків

Без цього команда стартуватиме на забрудненому execution surface.

### Wave 1. Stand Up CRM Delivery Foundation

Підняти чистий execution baseline для CRM:

- repo/workspace decision
- env contract
- app skeleton
- auth, org/workspace model, audit trail, background jobs
- мінімальний CI / lint / test baseline

### Wave 2. Implement Pilot CRM Core

Робити лише rehearsal-critical для CRM pilot:

- orders
- customers
- marketplace accounts
- sync jobs
- operator console для ручної роботи з замовленнями

### Wave 3. Add Marketplace Adapters

Після green core baseline:

- `ROZETKA` adapter v0.1
- `Prom` adapter beta
- ingestion/status reconciliation

## Ready-To-Assign Tasks

### Task A. Зафіксувати canonical CRM execution workspace

Чому зараз:

- без цього інженерна робота стартує в repo з великим стороннім WIP

Scope:

- прийняти рішення: новий repo чи новий top-level package в існуючому workspace
- зафіксувати, що саме можна reuse з `youtube_translation`, а що треба архівувати
- оформити freeze policy для поточного diff

Exit criteria:

- є одне канонічне місце для CRM execution
- є список дозволених reusable артефактів
- `youtube_translation` WIP більше не є implicit dependency для CRM

Recommended owner:

- CEO + Founding Engineer

### Task B. Підняти CRM delivery foundation v0

Чому зараз:

- це перший execution slice, який реально зрушує CRM з planning у delivery

Scope:

- backend + frontend skeleton
- auth/org model
- database baseline
- background worker / queue contract
- health, lint, unit-test baseline

Exit criteria:

- локальний bootstrap прогнозований
- проходять базові quality gates
- є місце для наступного slice без архітектурного дрейфу

Recommended owner:

- Founding Engineer

### Task C. Описати marketplace integration contract для `ROZETKA` v0.1

Чому зараз:

- без контракту ми ризикуємо побудувати CRM ядро, яке не стикується з реальним channel data shape

Scope:

- order schema
- customer identity rules
- status mapping
- sync cadence
- error handling і reconciliation rules

Exit criteria:

- зафіксований adapter contract
- зрозуміло, які поля потрібні в core CRM model
- `Prom` може бути реалізований як другий adapter без переробки core

Recommended owner:

- Founding Engineer

### Task D. Реалізувати CRM pilot contour: order inbox + customer context

Чому зараз:

- це найкоротший шлях до цінності для оператора

Scope:

- order list / inbox
- customer card
- order details
- manual status action
- audit log

Exit criteria:

- оператор може побачити замовлення, клієнта і зробити керовану дію
- є основа для підключення marketplace adapter'ів

Recommended owner:

- Founding Engineer

## Ризики, які варто проговорити до старту

- Якщо reuse-політика не буде зафіксована, CRM стартує на випадковому mix старого streaming-коду і нового продуктового ядра.
- Якщо AI повернути в пріоритет раніше core pilot, delivery знову розмиється.
- Якщо `ROZETKA` і `Prom` підуть одночасно без вузького canonical data model, ми втратимо час на adapter-driven refactor.

## Рекомендована дія CEO просто зараз

1. Закріпити Task A як термінове рішення.
2. Одразу після цього видати Founding Engineer новий active execution issue на Task B.
3. Task C створити паралельно як architecture/design slice.
4. Task D стартувати тільки після green baseline з Task B і після adapter contract з Task C.
