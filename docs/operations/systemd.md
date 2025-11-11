# Керування стрімами через systemd

Ціль: тримати FFmpeg-процеси живими незалежно від FastAPI. Кожен стрім
запускається як служба `ffmpeg@<stream_id>.service`, яка викликає
`python -m app.cli.run_stream` і автоматично перезапускається після збоїв.

## Попередні умови

1. Репозиторій розгорнуто у, наприклад, `/opt/youtube_translation`.
2. Створено віртуальне середовище (`python -m venv .venv`) і встановлено
   залежності `pip install -r backend/requirements.txt`.
3. Файл `backend/.env` містить усі налаштування (DB, Supabase, FFmpeg тощо).

## Налаштування unit-файлу

1. Скопіюйте `docs/systemd/ffmpeg@.service.example` у
   `/etc/systemd/system/ffmpeg@.service`.
2. Відредагуйте:
   - `WorkingDirectory` – шлях до каталогу `backend`.
   - `EnvironmentFile` – шлях до `.env`.
   - `ExecStart` – інтерпретатор вашого віртуального середовища.
   - `User`/`Group` – системний користувач, від якого запускати FFmpeg.
3. Перезавантажте systemd: `sudo systemctl daemon-reload`.

## Керування стрімами

Кожен stream має свій UUID (з таблиці `streams`). Приклад команд:

```bash
# Запуск стріму та автозапуск після перезавантаження
sudo systemctl enable --now ffmpeg@6f2a2a8d-1d9c-49b9-b500-511e1c7f7ea3

# Перевірити стан / журнал
systemctl status ffmpeg@6f2a2a8d-1d9c-49b9-b500-511e1c7f7ea3
journalctl -u ffmpeg@6f2a2a8d-1d9c-49b9-b500-511e1c7f7ea3 -f

# Зупинити тимчасово
sudo systemctl stop ffmpeg@6f2a2a8d-1d9c-49b9-b500-511e1c7f7ea3

# Перезапустити після зміни плейлиста
sudo systemctl restart ffmpeg@6f2a2a8d-1d9c-49b9-b500-511e1c7f7ea3
```

Служба має `Restart=always` і `RestartSec=5s`, тому FFmpeg піднімається після
будь-яких збоїв. Завершення `systemctl stop` або SIGTERM коректно викликає
`FFmpegStreamManager.stop_stream()` у CLI.

## Інтеграція з бекендом

На другому етапі плану бекенд перестає напряму викликати
`FFmpegStreamManager.start_stream` і замість цього виконує `systemctl start/stop`
для відповідних unit-файлів. Це дозволяє API рестартуватись без втрати стрімів
та спрощує моніторинг через `systemctl`/`journalctl`.

