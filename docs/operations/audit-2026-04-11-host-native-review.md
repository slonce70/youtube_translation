# Аудит 2026-04-11: host-native control plane review

> Це доповнення до `docs/operations/audit-2026-04-11-project-review.md`.
> Попередній документ охопив streaming runtime, degraded-live signals, MediaMTX
> та capacity. Цей звіт не дублює ті розділи — він фокусується виключно на тому,
> що змінилося після нього: підготовка і виконання host-native cutover
> (`STREAM_RUNTIME_MODE=systemd`) на production VPS.
>
> **Стан production на момент аудиту:** host-native backend активний. Commit
> `8f138dd` (2026-04-11) фіксує це як явно детектовану умову
> у `.github/workflows/deploy-vps.yml` — деплой тепер прибирає
> `backend`/`runner` із Docker service list, якщо `systemctl is-active --quiet
> youtube-backend` повертає `true`. Тобто cutover уже відбувся, не "готується
> до виконання".
>
> **Короткий висновок:** вердикт **REQUEST CHANGES**. Продакшен працює, але
> артефакти, що описують *як саме він був піднятий*, неповні. Наступне
> розгортання на новому хості, перестворення `streambot` venv, або навіть
> повторний запуск `install_systemd_runtime.sh` на поточному VPS не відтворить
> робочий стан без ручних кроків, яких немає у репозиторії.
>
> **Статус цього звіту зараз:** історичний snapshot. Пункти про privilege
> bootstrap, canonical `backend/.venv`, anti-flap guard, host-native venv
> provisioning і `From zero to green` bootstrap checklist уже відображені в
> поточних `scripts/*`, `docs/systemd/*`, `docs/operations/systemd.md` і
> `README.md`.

## 1. Що реально змінилося з попереднього аудиту

| Commit | Що додано |
|--------|-----------|
| `19b17ae` | Harden stream resilience + підготовка host-native cutover (degraded-live promotion, нові signal specs, system alerts для `remote_output_reset` / `recovery_storm` / `non_monotonic_dts`) |
| `b2ededd` | Fail-closed перевірки у `cutover_host_runtime.sh` / `rollback_host_runtime.sh` (active streams, host loopback `127.0.0.1:5432` і `127.0.0.1:6379`); `check_host_runtime_readiness.sh` |
| `a589b12` | `run_stream_systemd.sh` тепер шукає Python у `backend/.venv` перш ніж у repo-root `.venv` — unblock canary, що не стартував через відсутній uvicorn/python у root venv |
| `5649574` | `deploy_vps.sh` толерантний до `git config --global --add safe.directory` guard на remote checkout |
| `8f138dd` | Production-state discovery у GitHub Actions тепер читає `systemctl is-active youtube-backend` і виключає `backend`/`runner` із service set, коли host-native active |

Тобто за останню добу:

1. Стримінг-резіл'єнс із попереднього аудиту був додатково задокументований
   у signals/alerts.
2. Cutover-helpers отримали fail-closed рамки.
3. `run_stream_systemd.sh` перейшов від "hardcoded venv" до "auto-resolution
   between `backend/.venv` і `.venv`".
4. Production deploy workflow визнав host-native топологію як first-class
   state.

Проте три з цих речей (#2, #3, #4) — це реактивні фікси помилок, які вже
траплялися у боях (`Not-tested: End-to-end GitHub Actions deploy with
host-native backend active` у `8f138dd`), а не проактивне планування. Це
нормально для canary, але говорить, що наступна проблема ще не зловлена.

## 2. Нові HIGH findings

### 2.1 Privilege reproducibility gap

**Знахідка.** Репозиторій описує `youtube-backend.service` з
`User=streambot`, а `backend/app/core/systemd_control.py` керує stream
units через голий `systemctl start/stop/restart`:

```python
# backend/app/core/systemd_control.py
process = await asyncio.create_subprocess_exec(
    settings.systemctl_path, *args,
    stdout=PIPE, stderr=PIPE,
)
```

— без `sudo`, без wrapper-а, без `pkexec`. Щоб це працювало на системних
unit-файлах у `/etc/systemd/system/ffmpeg@*.service` під користувачем
`streambot`, на хості має існувати одне з:

- polkit rule, що дозволяє `streambot` керувати `ffmpeg@*.service`;
- sudoers entry `streambot ALL=NOPASSWD: /usr/bin/systemctl ...`;
- або backend реально запущений як root (що порушує `NoNewPrivileges=true`
  і стартовий unit).

Але:

```
$ grep -r "polkit\|sudoers" ~/Documents/Work/youtube_translation
(порожньо)
```

У всьому репозиторії нуль згадок polkit або sudoers. Readiness-скрипт
(`check_host_runtime_readiness.sh`) теж не перевіряє, що `streambot` реально
може керувати `ffmpeg@` unit-ами.

**Чому це важливо.** Продакшен працює — отже, хтось налаштував це
вручну на VPS. Але цього *нема* у:

- `scripts/install_systemd_runtime.sh`
- `scripts/deploy_vps.sh`
- `docs/operations/systemd.md`
- `docs/operations/audit-2026-04-11-project-review.md`

Наслідки:
1. **Новий хост** (DR, staging, blue/green) — не запуститься, доки хтось із
   памʼяті не додасть polkit/sudoers.
2. **Повторний запуск** `install_systemd_runtime.sh` на чистому чекауті
   (наприклад, після rebuild VPS із бекапу) — лишиться без privilege hook.
3. **Security audit trail** — немає запису про те, хто і коли розширив
   privileges для `streambot`, і що саме дозволено. Це прямий блокер для
   compliance review.

**Зауваження про рамки.** Формулювання НЕ "це не може працювати". Формулювання:
**артефакти репо не відтворюють робочий стан прод.** Privilege gap — це
невидима передумова, без якої все решта не функціонує.

**Рекомендовано.**

1. Додати `docs/systemd/polkit/youtube-ffmpeg.pkla` (або `.rules` для
   `polkitd`) як example з явним дозволом `streambot` на
   `org.freedesktop.systemd1.manage-units` для unit pattern `ffmpeg@*`
   і `youtube-backend`.
2. Додати idempotent install step у `scripts/install_systemd_runtime.sh`
   за прапорцем `SYSTEMD_INSTALL_POLKIT=1`.
3. Розширити `check_host_runtime_readiness.sh` перевіркою:
   `sudo -u streambot systemctl --dry-run start ffmpeg@__readiness_probe`
   (або аналогом через `busctl`) і повертати `host_streambot_systemctl=allowed|denied|unknown`.
4. У `docs/operations/systemd.md` додати секцію "Privilege bootstrap" перед
   cutover checklist.

**Severity.** HIGH (reproducibility блокер, compliance-relevant,
навколишньо невидимо). Поки прод працює — це не P1, але перший hard failure
на новому хості буде P1.

---

### 2.2 Venv path mismatch — три різні contracts

**Знахідка.** Три компоненти, що мають використовувати той самий Python
venv, вказують на різні місця:

| Файл | Що там |
|------|--------|
| `docs/systemd/youtube-backend.service.example:15` | `ExecStart=/opt/youtube_translation/.venv/bin/uvicorn ...` (repo-root `.venv`) |
| `scripts/install_systemd_runtime.sh:35-36` | Рендер підставляє **тільки** repo-root `.venv/bin/uvicorn` і `.venv/bin/python` |
| `scripts/run_stream_systemd.sh:37-44` | Автовирішення: спершу `backend/.venv`, потім repo-root `.venv` |
| `scripts/check_host_runtime_readiness.sh:68-72` | Перевіряє **обидва** layouts — `$install_root/backend/.venv/bin/python` і `$install_root/.venv/bin/python` |

Тобто:

- **Stream wrapper** (`run_stream_systemd.sh`) уміє з двома layout-ами — це
  був цілеспрямований фікс у commit `a589b12`.
- **Readiness-скрипт** теж перевіряє обидва — знає, що у продакшені може
  бути або `backend/.venv`, або `.venv`.
- **Install helper** знає тільки про repo-root `.venv`.
- **Backend service example** знає тільки про repo-root `.venv`.

**Чому це важливо.** Якщо на VPS venv реально лежить у
`/opt/youtube_translation/backend/.venv` (що підтверджується і фіксом у
`a589b12`, і факт перевірки обох шляхів у readiness-скрипті), то:

1. `youtube-backend.service`, згенерований `install_systemd_runtime.sh`,
   не запустить uvicorn (немає файлу за шляхом у `ExecStart`).
2. Якщо ж venv зараз у repo-root `.venv` — то `run_stream_systemd.sh`
   працює завдяки fallback, але commit `a589b12` описує, що саме
   `backend/.venv` був первинний canary blocker.

В обох сценаріях одне contract розходиться з іншими двома. Це або
**прод падає при reinstall**, або **був вручну хакнутий** щоб розвʼязати
протиріччя, або один із sources-of-truth просто брехня.

**Рекомендовано.**

1. Визначити канонічну відповідь: "host-native venv живе у
   `{install_root}/backend/.venv`" і задокументувати це як contract у
   `docs/operations/systemd.md`.
2. Привести `install_systemd_runtime.sh` до відповідності: або render
   різних шляхів залежно від `SYSTEMD_BACKEND_VENV_DIR`, або auto-detect
   за аналогією з `run_stream_systemd.sh`.
3. Привести `youtube-backend.service.example` або до `backend/.venv`, або
   до tokenized placeholder, який install-хелпер заповнює.
4. Додати у `check_host_runtime_readiness.sh` окремі поля
   `host_backend_uvicorn_repo` і `host_backend_uvicorn_backend` замість
   одного збірного `host_backend_uvicorn=present:<path>`, щоб diff-тул
   вловлював, який layout активний.

**Severity.** HIGH. Разом із 2.1 це два різні сторони однієї проблеми:
repo не описує точний стан прод.

---

## 3. Нові MEDIUM findings

### 3.1 Restart-loop risk: `Restart=always` + CLI без terminal-state guard

**Знахідка.** У `docs/systemd/ffmpeg@.service.example`:

```
Restart=always
RestartSec=5s
```

Без `StartLimitBurst=`, без `StartLimitIntervalSec=`, без
`StartLimitAction=`.

Водночас `backend/app/cli/run_stream.py` при запуску:

```python
# backend/app/cli/run_stream.py:202-244
async def _start_stream(stream_id: UUID, wait: bool = True) -> None:
    async with async_session_maker() as db:
        stream, user_id = await _load_stream_with_relations(db, stream_id)
        ...
        playlists, destinations, log_file = await prepare_stream_launch(...)
        success = await ffmpeg_manager.start_stream(...)
        if not success:
            raise RuntimeError("Failed to start FFmpeg process")
        stream.status = "running"
        stream.started_at = _utcnow()
        ...
```

**НЕ перевіряє**, у якому стані знаходиться стрім. Якщо попередній cycle
`_update_stream_status_after_exit` поставив `status="error"`, новий процес
(запущений systemd через `Restart=always`) завантажить той самий стрім,
викличе `prepare_stream_launch`, і **перепише `status = "running"`**
безумовно.

Сценарії, де це стріляє:
1. FFmpeg відразу падає через auth-помилку YouTube key → CLI ставить
   `error` → systemd через 5 секунд знов піднімає → CLI знов ставить
   `running` → FFmpeg знов падає. Infinite loop, без upper bound,
   з flapping у UI та записом у `stream_events` кожні ~5 секунд.
2. Брутальний crash runner-а (SIGKILL, OOM) без виконання
   `_update_stream_status_after_exit` — DB зберігає `running`, systemd
   піднімає новий процес, `_start_stream` проходить тому що стрім вже
   `running` (але старого PID немає), і loop продовжується.

**Що пом'якшує (частково).**

- `_heartbeat_loop` перевіряє lease ownership і зупиняється, якщо lease
  зʼїхав на інший node. Але в loop-і, що рестартається на тому ж хості,
  lease повертається до того ж `node_id`, тому це не ловить.
- Resource isolation у `streaming.slice` (CPUQuota/MemoryMax) обмежить
  blast radius, але не зупинить логічне flapping.
- `ffmpeg_output_recovery_max_attempts` обмежує recovery усередині
  одного FFmpeg run, не зовнішнє systemd-рестартування.

**Рекомендовано.**

1. **systemd side.** Додати до `ffmpeg@.service.example`:
   ```
   StartLimitBurst=5
   StartLimitIntervalSec=300
   StartLimitAction=none
   ```
   Це зупинить unit після 5 рестартів за 5 хвилин. Поєднано з існуючим
   `OOMPolicy=stop` це гарантує, що зламаний стрім не крутитиметься вічно.

2. **CLI side.** Додати у `_start_stream` early-return після
   `_load_stream_with_relations`:
   ```python
   if stream.status in {"error", "stopped", "archived"}:
       LOGGER.warning(
           "Stream %s is in terminal state %s; refusing to re-launch",
           stream_id, stream.status,
       )
       return
   ```
   І нехай `main()` повертає dedicated exit code (наприклад, `10`), щоб
   systemd бачив різницю між "crash" і "refuse".

3. **Observability.** У `system_alerts` додати event
   `stream_runtime_refused_terminal_state` для кожного такого refusal,
   щоб flap ловився у ops.

**Severity.** MEDIUM. Не спрацює, поки прод стабільний, але наступний
bad destination key піднімає alert storm. Попередній аудит уже зафіксував
`stream_events=16` за період — частина цих подій могла бути саме таким
flapping-ом, це варто перевірити по журналу.

---

### 3.2 `deploy_vps.sh` не провіжинить host-native venv

**Знахідка.** Читання `scripts/deploy_vps.sh`:

- Є `maybe_install_systemd_runtime_units` → викликає
  `install_systemd_runtime.sh` (тільки unit files + daemon-reload).
- Є `maybe_run_host_runtime_cutover` → викликає `cutover_host_runtime.sh`.
- **Нема** кроку, який створює `/opt/youtube_translation/backend/.venv`
  (або `.venv`) з `pip install -r backend/requirements.txt`.
- **Нема** кроку, який робить `uv pip sync` чи `poetry install` у
  відповідному шляху.

Тобто workflow має: "postaviti unit files" → "zrobyty cutover" → ", а
venv там уже має бути". На поточному VPS — він є (бо руками встановили).
На новому — його не буде, і `youtube-backend.service` впаде на старті з
ENOENT на uvicorn.

**Рекомендовано.** Додати у `scripts/deploy_vps.sh` фазу
`provision_host_native_backend_venv`, яка запускається тільки коли
`host_backend_active=true` або коли викликається з `--prepare-host-native`:

```bash
provision_host_native_backend_venv() {
  local venv_dir="${INSTALL_ROOT}/backend/.venv"
  if [[ ! -x "$venv_dir/bin/python" ]]; then
    python3 -m venv "$venv_dir"
  fi
  "$venv_dir/bin/python" -m pip install -U pip wheel
  "$venv_dir/bin/python" -m pip install -r "${INSTALL_ROOT}/backend/requirements.txt"
}
```

Ідемпотентний, перевіряється по `check_host_runtime_readiness.sh`.

**Severity.** MEDIUM. Не впливає на поточний прод. Повністю блокує
disaster recovery / second host bootstrap.

---

### 3.3 Відсутній bootstrap checklist у `docs/operations/systemd.md`

**Знахідка.** Документ `docs/operations/systemd.md` описує:

- Що таке systemd режим.
- Як копіювати приклади unit-файлів.
- Як викликати `cutover_host_runtime.sh`.
- Як зробити rollback.

Але **НЕ описує** першу послідовність кроків "from zero to green" на
новому VPS:

1. Створити системного користувача `streambot`.
2. Створити `/opt/youtube_translation` із відповідним ownership.
3. Налаштувати polkit/sudoers (див. 2.1).
4. Провіжинити venv (див. 3.2).
5. Запустити `install_systemd_runtime.sh`.
6. Перевірити `check_host_runtime_readiness.sh`.
7. Запустити `cutover_host_runtime.sh`.

Без цього checklist-а команда повторно відновлює все з памʼяті.

**Severity.** MEDIUM (operational hygiene, DR readiness).

---

## 4. LOW / INFO

### 4.1 Docker-coupling зберігається

`youtube-backend.service.example` має:

```
After=network-online.target docker.service
Requires=docker.service
```

Це прагматично — Postgres і Redis живуть у Docker, і backend не запрацює
без них. Але *задекларована* мета host-native control plane — зробити API
незалежним від Docker daemon restart. `Requires=docker.service` означає,
що `systemctl restart docker` досі зупиняє `youtube-backend`.

Це не баг — це чесний trade-off на цьому етапі migration. Але варто
відмітити у `docs/operations/systemd.md`, що **повний** host-native стан
(Postgres і Redis теж host-native, backend без `Requires=docker.service`)
ще попереду, а не "ми вже там".

### 4.2 Readiness-скрипт не перевіряє polkit flow

Продовження 2.1: `check_host_runtime_readiness.sh` перевіряє наявність
unit файлів, стан юнітів, loopback ports, Python/uvicorn бінарі — але
не пробує виконати privilege operation як `streambot`. Це діра у
"readiness" definition.

### 4.3 Коротка ремарка про існуючі позитиви

Щоб не створювати хибного враження, що звіт однобокий:

- **Fail-closed валідатор конфіга** (`ALLOW_UNSAFE_CONTAINERIZED_SYSTEMD_RUNTIME`)
  зроблений правильно: блокує небезпечну комбінацію за замовчуванням,
  вимагає явного opt-in, документує *чому*.
- **`cutover_host_runtime.sh` / `rollback_host_runtime.sh`** мають
  fail-closed guards: active streams, loopback ports, dry-run override.
- **`check_host_runtime_readiness.sh`** покриває більшість host-side
  state (крім 4.2).
- **`run_stream_systemd.sh` wrapper** — explicit python resolution, окремий
  wrapper log, нон-hardcoded PATH. Це acceptable pattern.
- **Production-state discovery у `.github/workflows/deploy-vps.yml`**
  тепер визнає host-native топологію і не пробує переустановити Docker
  backend поверх неї (`8f138dd`). Це правильний фікс, але він реактивний.
- **`19b17ae` degraded-live promotion** — посилення системних сигналів
  відповідає тому, що зазначав попередній аудит як прогалину.

### 4.4 Housekeeping

- `git status` показує: `D admin-local.png`, `D library-after-upload.png`,
  `D library-local.png` — три видалені скріншоти, не закомічені. Видалити
  окремим housekeeping-комітом.
- `backend/.env.bak-*` — ігноруються через `.gitignore`, але існують у
  checkout. Переглянути, чи не містять secrets, і видалити з робочої
  копії.
- Попередній аудит (`audit-2026-04-11-project-review.md`) варто
  cross-link-нути з цим документом, щоб читач бачив повну картину.

---

## 5. Action list (priority order)

| # | Дія | Severity | Де |
|---|-----|----------|-----|
| 1 | Додати polkit/sudoers example + install step + readiness check | HIGH | 2.1 |
| 2 | Привести до одного venv path contract (service example + install script + docs) | HIGH | 2.2 |
| 3 | Додати `StartLimitBurst`/`StartLimitIntervalSec` у `ffmpeg@.service.example` + terminal-state guard у `app.cli.run_stream._start_stream` + alert | MEDIUM | 3.1 |
| 4 | Додати `provision_host_native_backend_venv` фазу у `deploy_vps.sh` | MEDIUM | 3.2 |
| 5 | Написати "From zero to green" bootstrap checklist у `docs/operations/systemd.md` | MEDIUM | 3.3 |
| 6 | Задокументувати, що Docker-незалежність — майбутня фаза, не поточний стан | LOW | 4.1 |
| 7 | Housekeeping: commit видалених PNG, прибрати `.env.bak-*` | LOW | 4.4 |
| 8 | Перевірити журнал `stream_events` за останні 24 год на flapping pattern — якщо є, підтверджує 3.1 як P1, а не MEDIUM | — | 3.1 |

---

## 6. Підсумок

Попередній аудит (`audit-2026-04-11-project-review.md`) зафіксував runtime
resilience як головний ризик. За минулу добу цей ризик був матеріально
зменшений: з'явилися signal specs, cutover helpers, fail-closed валідатори,
production cutover відбувся. Це правильний напрямок і сумлінна реалізація.

Проте host-native cutover створив **нову категорію ризику**: репозиторій
більше не є повним описом продакшена. Є принаймні три невидимі залежності
(privilege mechanism, фактичний venv layout, відсутній bootstrap) без
яких артефакти у `scripts/` та `docs/systemd/` не відтворять поточний
стан VPS. Якщо завтра знадобиться перенести сервіс на новий хост,
перший deploy впаде — питання тільки в тому, на якому з цих трьох кроків.

Не вимагаю зупиняти streaming work — прод стабільний і нова робота
виглядає обґрунтованою. Вимагаю **paralel track**: перед наступним
feature PR — закрити пункти 1–5 з action list, особливо 1 і 2. Це
декілька годин роботи, але вони конвертують "working on the VPS" у
"reproducible on any VPS", що й було первинною метою host-native
cutover-у.

— Вердикт: **REQUEST CHANGES** (стосовно репрезентативності артефактів;
не стосовно якості runtime-а як такого).
