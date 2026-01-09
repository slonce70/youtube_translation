# Запуск і тестування (актуально)

## Швидкий старт (локально)

1) Підняти базові сервіси (Postgres + Redis + tusd)
```
docker compose -f docker/docker-compose.yml up -d
```

2) Запустити бекенд
```
./start-backend.sh
```

3) Запустити фронтенд
```
./start-frontend.sh
```

Додатково, tusd можна запускати окремо (якщо не користуєтесь docker):
```
./start-tusd.sh
```

## Тестування

Backend:
```
cd backend
FFMPEG_BIN=tests/bin/ffmpeg ./.venv/bin/python -m pytest -v
```

Frontend unit:
```
cd frontend
CI=1 npm test
```

Frontend e2e (Playwright):
```
cd frontend
npm run test:e2e
```

## Нотатки
- Для e2e увімкнено dev-bypass авторизації (`NEXT_PUBLIC_DEV_BYPASS_AUTH=1`).
- Якщо потрібно перевірити реальний редірект /dashboard → /login, запустіть e2e з `NEXT_PUBLIC_DEV_BYPASS_AUTH=0`.
