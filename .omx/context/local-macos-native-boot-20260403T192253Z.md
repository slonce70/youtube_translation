Task statement
- Install and start the YouTube translation project on macOS so the user can test it now, preferring the least heat-heavy local setup and closing unnecessary background stack pieces.

Desired outcome
- Backend, frontend, and tusd run locally.
- Required local services are installed and reachable.
- Docker is avoided unless it proves materially better.
- The user gets a stable localhost baseline for manual testing.

Known facts and evidence
- Docker containers are currently not running.
- `backend/.env` and `frontend/.env.local` already exist.
- `ENABLE_DEV_AUTH=true` and `NEXT_PUBLIC_DEV_BYPASS_AUTH=1` are configured.
- `backend/.venv` exists and `frontend/node_modules` exists.
- Global Homebrew toolchain binaries for `ffmpeg`, `postgres`, `redis`, `tusd` are not currently in PATH.
- `backend/.venv` already contains `supervisord`, `supervisorctl`, and `uvicorn`.

Constraints
- User wants the laptop to stay cooler and less laggy than the Docker path.
- Do not expose secrets from env files.
- Prefer direct execution and verification over advice.

Unknowns and open questions
- Which native packages still need installation through Homebrew.
- Whether PostgreSQL data dir needs first-time init.
- Whether any repo scripts need patching for the fully native baseline.

Likely codebase touchpoints
- `README.md`
- `Makefile`
- `start-backend.sh`
- `start-frontend.sh`
- `start-tusd.sh`
- `backend/.env`
- `frontend/.env.local`
