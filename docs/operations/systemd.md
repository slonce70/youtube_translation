# systemd для Linux production

`systemd` у цьому проєкті призначений для Linux/VPS production-сценарію. Це не канонічний локальний bootstrap path.

Важливо: цей шлях розрахований на host-native control plane. Якщо backend сам працює в контейнері, комбінація `STREAM_RUNTIME_MODE=systemd` для `staging`/`production` тепер fail-closed блокується конфіг-валідатором без явного `ALLOW_UNSAFE_CONTAINERIZED_SYSTEMD_RUNTIME=true`, доки не буде окремо впроваджено і задокументовано підтриманий host-level control path.

## Коли використовувати

Використовуйте `STREAM_RUNTIME_MODE=systemd`, якщо потрібно:
- переживати рестарти API без втрати FFmpeg-процесів
- керувати стрімами через systemd units
- інтегрувати логи та рестарти з системним менеджером сервісів

## Базова схема

Підтримуваний production shape для цього режиму:

- host-native backend service на `127.0.0.1:8000`
- host-native `ffmpeg@<stream_id>` units
- канонічний Python layout для host-native backend: `/opt/youtube_translation/backend/.venv`
- Docker infra для `postgres`, `redis`, `tusd`, `frontend`, `mediamtx`
- `postgres` і `redis` публікуються лише на loopback (`127.0.0.1:5432`, `127.0.0.1:6379`), щоб backend control plane на хості міг працювати без Docker-in-Docker або container-to-host `systemctl` hacks
- `frontend` і `tusd` у containerized lane можуть бути перепідняті з `FRONTEND_API_PROXY_TARGET` / `TUSD_BACKEND_URL`, що вказують на `http://host.docker.internal:8000`, коли backend уже host-native

## Privilege bootstrap

`youtube-backend.service` і `ffmpeg@.service` запускаються від користувача `streambot`, тому керування `systemctl` для stream units має бути дозволене явно. Репозиторій тепер містить приклад polkit rule:

- `docs/systemd/polkit/youtube-ffmpeg.rules.example`

Рекомендований шлях для VPS:

```bash
sudo install -D -m 0644 \
  docs/systemd/polkit/youtube-ffmpeg.rules.example \
  /etc/polkit-1/rules.d/50-youtube-ffmpeg.rules
```

Repo-native helper теж уміє поставити цей rule:

```bash
sudo SYSTEMD_INSTALL_ROOT=/opt/youtube_translation \
  SYSTEMD_SERVICE_USER=streambot \
  SYSTEMD_SERVICE_GROUP=streambot \
  SYSTEMD_INSTALL_POLKIT=1 \
  ./scripts/install_systemd_runtime.sh
```

Той самий helper тепер ідемпотентно створює `SYSTEMD_SERVICE_USER` / `SYSTEMD_SERVICE_GROUP`, якщо їх ще немає на VPS, і вирівнює `backend/.env` до group-readable mode для цього service account. Тобто production bootstrap більше не залежить від ручного `useradd` або ручного `chmod` на secrets-файлі, якщо installer викликається з root/passwordless sudo. За потреби ці кроки можна вимкнути через `SYSTEMD_ENSURE_SERVICE_ACCOUNT=0` або `SYSTEMD_ALIGN_ENV_PERMISSIONS=0`.

Якщо ваш дистрибутив не використовує `polkit` для `org.freedesktop.systemd1.manage-units`, задокументуйте еквівалентний `sudoers` hook окремо. Не залишайте privilege path як “ручний секрет VPS”.

## From Zero To Green

Це канонічний bootstrap на новому VPS.

1. Створіть каталоги checkout-а:
```bash
sudo mkdir -p /opt/youtube_translation
```

2. Розгорніть git checkout у `/opt/youtube_translation`, підкладіть `backend/.env`, підніміть Docker infra (`postgres redis tusd frontend mediamtx`) і переконайтеся, що `127.0.0.1:5432` та `127.0.0.1:6379` уже слухають.

3. Поставте privilege hook з секції вище.

4. Провіжиньте host-native backend venv:
```bash
sudo SYSTEMD_INSTALL_ROOT=/opt/youtube_translation \
  ./scripts/provision_host_native_backend_venv.sh
```

5. Встановіть unit-файли:
```bash
sudo SYSTEMD_INSTALL_ROOT=/opt/youtube_translation \
  SYSTEMD_SERVICE_USER=streambot \
  SYSTEMD_SERVICE_GROUP=streambot \
  SYSTEMD_INSTALL_POLKIT=1 \
  ./scripts/install_systemd_runtime.sh
```

6. Увімкніть у `backend/.env`:
```env
STREAM_RUNTIME_MODE=systemd
SYSTEMD_UNIT_TEMPLATE=ffmpeg@{stream_id}
SYSTEMCTL_PATH=systemctl
DATABASE_URL=postgresql://youtube_user:...@127.0.0.1:5432/youtube_streaming
REDIS_URL=redis://127.0.0.1:6379/0
```

Installer з попереднього кроку автоматично вирівнює цей файл до `0640` і `chgrp streambot`, щоб host-native backend міг його прочитати.

Для host-native cutover збережіть `UPLOAD_DIR=./uploads` і `STREAM_DIR=./streams`. GitHub deploy path тепер сам:
- синкає legacy data у `/opt/youtube_translation_data/{uploads,streams,logs,supervisord}`
- прив'язує `backend/{uploads,streams,logs,supervisord}` symlink-ами до цих persistent каталогів

Це дозволяє:
- не ламати containerized compose mounts, які як і раніше очікують `/app/uploads` всередині контейнерів
- одночасно дати host-native backend доступ до того самого persistent storage через його repo-local relative paths
- запускати старі stream/assets записи з `storage_path=/app/uploads/...`, бо backend тепер backward-compatible remap-ить legacy filesystem paths у поточний user upload root
- гарантувати, що `streambot` реально має group-read/group-write доступ до persistent storage (`uploads`, `streams`, `logs`, `supervisord`), а нові підкаталоги наслідують правильну групу через setgid

7. Проганяйте readiness before cutover:
```bash
sudo SYSTEMD_INSTALL_ROOT=/opt/youtube_translation \
  SYSTEMD_SERVICE_USER=streambot \
  ./scripts/check_host_runtime_readiness.sh
```

Очікування для green state:
- `host_backend_python_backend=present:.../backend/.venv/bin/python`
- `host_backend_uvicorn_backend=present:.../backend/.venv/bin/uvicorn`
- `host_service_user_exists=present`
- `host_service_user_systemctl=allowed`

8. Активуйте backend і за потреби canary stream:
```bash
sudo systemctl enable --now youtube-backend
sudo systemctl enable --now ffmpeg@<stream_uuid>
```

9. Лише після readiness/canary запускайте `cutover_host_runtime.sh`.

Примітка для вже-cutover VPS: `scripts/deploy_vps.sh` тепер вважає активний `youtube-backend` unit джерелом істини для host-native refresh path. Якщо unit уже активний, але `backend/.env` усе ще містить старі container-era значення, deploy automation ідемпотентно вирівнює:
- `STREAM_RUNTIME_MODE=systemd`
- `UPLOAD_DIR=./uploads`
- `STREAM_DIR=./streams`

Тобто host-native backend повертається до канонічного repo-local contract, а реальний persistent storage забезпечують symlink-и на `/opt/youtube_translation_data/...`.

## Manual install details

1. Скопіюйте шаблони вручну, якщо не використовуєте helper:
```bash
sudo cp docs/systemd/youtube-backend.service.example /etc/systemd/system/youtube-backend.service
sudo cp docs/systemd/streaming.slice.example /etc/systemd/system/streaming.slice
sudo cp docs/systemd/ffmpeg@.service.example /etc/systemd/system/ffmpeg@.service
```

2. Відредагуйте шляхи, користувача та virtualenv.
   Канонічний layout для production: `backend/.venv`.
   Stream wrapper `scripts/run_stream_systemd.sh` усе ще вміє fallback у repo-root `.venv` для старих хостів, але нові інсталяції не повинні на нього покладатися.
   Також одразу перевірте resource accounting directives:
   - `CPUAccounting=yes`
   - `MemoryAccounting=yes`
   - `TasksAccounting=yes`
   - `CPUQuota` / `MemoryMax` / `TasksMax`
   - `OOMPolicy=stop` для stream units
   - `StartLimitBurst=5` / `StartLimitIntervalSec=300` / `RestartPreventExitStatus=10` для stream units
   - `Slice=streaming.slice` для stream units
   Значення в шаблоні є безпечним стартовим baseline, але їх треба підтвердити measured workload profiles перед широким rollout.

3. Якщо backend працює host-native на Linux/VPS, цього достатньо. Якщо backend працює всередині контейнера, не вмикайте цей режим у `staging`/`production` без свідомого override і окремо перевіреного control-plane рішення.

4. Підніміть Docker infra, але без containerized backend/runner:
```bash
docker compose -f docker/docker-compose.yml up -d postgres redis tusd frontend mediamtx
```

5. Оновіть systemd і підніміть backend + конкретний стрім:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now youtube-backend
sudo systemctl enable --now ffmpeg@<stream_uuid>
```

Альтернатива через repo-native helper:

```bash
sudo SYSTEMD_INSTALL_ROOT=/opt/youtube_translation \
  SYSTEMD_SERVICE_USER=streambot \
  SYSTEMD_SERVICE_GROUP=streambot \
  SYSTEMD_INSTALL_POLKIT=1 \
  SYSTEMD_ENABLE_BACKEND=1 \
  ./scripts/install_systemd_runtime.sh
```

Для canary stream можна додати:

```bash
sudo SYSTEMD_INSTALL_ROOT=/opt/youtube_translation \
  SYSTEMD_INSTALL_POLKIT=1 \
  SYSTEMD_ENABLE_BACKEND=1 \
  SYSTEMD_ENABLE_STREAM_UNIT=<stream_uuid> \
  ./scripts/install_systemd_runtime.sh
```

Контрольоване переключення з Docker `backend`/`runner` на host-native backend service:

```bash
sudo BACKEND_ENV=/opt/youtube_translation/backend/.env \
  ALLOW_LIVE_STREAM_RUNTIME_CUTOVER=0 \
  CUTOVER_STOP_DOCKER_RUNTIME=1 \
  ./scripts/cutover_host_runtime.sh
```

Для reviewed canary stream:

```bash
sudo BACKEND_ENV=/opt/youtube_translation/backend/.env \
  CUTOVER_RUNTIME_MODE_OVERRIDE=systemd \
  ALLOW_LIVE_STREAM_RUNTIME_CUTOVER=1 \
  HOST_STREAM_UNIT_NAME=<stream_uuid> \
  ./scripts/cutover_host_runtime.sh
```

Rollback назад у Docker runtime lane:

```bash
sudo BACKEND_ENV=/opt/youtube_translation/backend/.env \
  ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK=0 \
  ROLLBACK_START_DOCKER_RUNTIME=1 \
  ./scripts/rollback_host_runtime.sh
```

Для reviewed rollback конкретного canary stream:

```bash
sudo BACKEND_ENV=/opt/youtube_translation/backend/.env \
  ROLLBACK_RUNTIME_MODE_OVERRIDE=systemd \
  ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK=1 \
  HOST_STREAM_UNIT_NAME=<stream_uuid> \
  ./scripts/rollback_host_runtime.sh
```

## Що робить unit

Backend unit запускає:

```bash
backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Stream unit запускає:

```bash
python -m app.cli.run_stream <stream_id>
```

CLI сам збирає плейлист, запускає FFmpeg і підтримує статус стріму в БД.
Якщо systemd намагається рестартувати stream unit після того, як БД уже перевела стрім у terminal state (`stopped` або `error`), CLI завершується кодом `10`, а unit більше не входить у нескінченний restart loop.

## Приклад

Шаблон unit-файлу лежить у:

- `docs/systemd/youtube-backend.service.example`
- `docs/systemd/streaming.slice.example`
- `docs/systemd/ffmpeg@.service.example`
- `docs/systemd/polkit/youtube-ffmpeg.rules.example`

## Resource isolation baseline

Початковий baseline у шаблонах навмисно conservative:

- backend control plane:
  - `MemoryMax=1G`
  - `TasksMax=512`
- stream units:
  - `CPUQuota=200%`
  - `MemoryMax=2G`
  - `TasksMax=128`
- aggregate slice:
  - `CPUQuota=300%`
  - `MemoryMax=5G`
  - `TasksMax=512`

Це не остаточні production цифри. Вони потрібні, щоб:

- fail-closed не дати одному процесу забрати весь хост без жодних меж
- мати canary-safe стартові обмеження
- далі відкалібрувати їх за measured profiles (`720p30`, `1080p30`, `4K60`, noisy timestamp cases)

## Зауваження

- Для локальної розробки prefer `supervisor`, а не `systemd`
- Якщо вам потрібен лише local smoke path, використовуйте DEV auth і hybrid boot з `docker compose -f docker/docker-compose.yml up -d postgres redis tusd runner`
- Containerized backend + `systemd` runtime не вважається підтриманим production control path за замовчуванням
- Якщо ви переходите на host-native backend control plane, не запускайте одночасно Docker `backend`/`runner` як production executors для тих самих live streams
- Якщо використовуєте `scripts/install_systemd_runtime.sh`, пам'ятайте: без `SYSTEMD_ENABLE_BACKEND=1` / `SYSTEMD_ENABLE_STREAM_UNIT=...` helper лише ставить unit-файли й робить `daemon-reload`, але не активує сервіси
- `scripts/deploy_vps.sh` тепер уміє ідемпотентно провіжинити `backend/.venv`, коли host-native backend уже активний або коли ви готуєте cutover через `DEPLOY_PREPARE_HOST_NATIVE=1`
- `scripts/deploy_vps.sh` також вирівнює `backend/{uploads,streams,logs,supervisord}` на symlink-и до `/opt/youtube_translation_data/...`, щоб host-native backend і containerized edge дивилися в один persistent storage root
- той самий deploy path тепер рекурсивно вирівнює group ownership і mode на `/opt/youtube_translation_data/{uploads,streams,logs,supervisord}` під `SYSTEMD_SERVICE_GROUP`, щоб host-native backend не впирався в `Permission denied` на старих assets після cutover
- `scripts/check_host_runtime_readiness.sh` тепер окремо показує `backend/.venv` vs repo-root `.venv` і перевіряє, чи service user реально може зробити `systemctl start --dry-run ffmpeg@__readiness_probe`
- `scripts/cutover_host_runtime.sh` навмисно fail-closed відмовляється від cutover при активних стрімах, якщо ви явно не задали `ALLOW_LIVE_STREAM_RUNTIME_CUTOVER=1`
- `scripts/cutover_host_runtime.sh` також fail-closed перевіряє, що host loopback `127.0.0.1:5432` і `127.0.0.1:6379` вже слухають, інакше host-native backend не отримає доступу до PostgreSQL/Redis після відключення Docker `backend`/`runner`
- `scripts/cutover_host_runtime.sh` також перепіднімає `frontend` і `tusd` з upstream `http://host.docker.internal:8000`, щоб containerized edge продовжив ходити в host-native backend
- `scripts/rollback_host_runtime.sh` так само fail-closed відмовляється від rollback при активних стрімах, якщо ви явно не задали `ALLOW_LIVE_STREAM_RUNTIME_ROLLBACK=1`
- `scripts/rollback_host_runtime.sh` повертає `frontend` і `tusd` назад на upstream `http://backend:8000`
- `CUTOVER_RUNTIME_MODE_OVERRIDE=systemd` і `ROLLBACK_RUNTIME_MODE_OVERRIDE=systemd` існують саме для безпечного dry-run / reviewed canary prep без зміни реального `backend/.env` на хості
- `Requires=docker.service` у `youtube-backend.service` є свідомим тимчасовим coupling: поки `postgres` і `redis` лишаються в Docker, повністю Docker-independent host-native state ще не досягнутий
