# systemd для Linux production

`systemd` у цьому проєкті призначений для Linux/VPS production-сценарію. Це не канонічний локальний bootstrap path.

## Коли використовувати

Використовуйте `STREAM_RUNTIME_MODE=systemd`, якщо потрібно:
- переживати рестарти API без втрати FFmpeg-процесів
- керувати стрімами через systemd units
- інтегрувати логи та рестарти з системним менеджером сервісів

## Базова схема

1. Скопіюйте шаблон:
```bash
sudo cp docs/systemd/ffmpeg@.service.example /etc/systemd/system/ffmpeg@.service
```

2. Відредагуйте шляхи, користувача та virtualenv.

3. Увімкніть у `backend/.env`:
```env
STREAM_RUNTIME_MODE=systemd
SYSTEMD_UNIT_TEMPLATE=ffmpeg@{stream_id}
SYSTEMCTL_PATH=systemctl
```

4. Оновіть systemd і підніміть конкретний стрім:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ffmpeg@<stream_uuid>
```

## Що робить unit

Unit запускає:

```bash
python -m app.cli.run_stream <stream_id>
```

CLI сам збирає плейлист, запускає FFmpeg і підтримує статус стріму в БД.

## Приклад

Шаблон unit-файлу лежить у:

- `docs/systemd/ffmpeg@.service.example`

## Зауваження

- Для локальної розробки prefer `supervisor`, а не `systemd`
- Якщо вам потрібен лише local smoke path, використовуйте DEV auth і hybrid boot з `docker compose -f docker/docker-compose.yml up -d postgres redis tusd runner`
