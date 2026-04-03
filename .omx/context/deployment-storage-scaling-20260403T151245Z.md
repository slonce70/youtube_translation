Task statement

Define a low-complexity deployment path that can be launched soon, stays stable for initial real-world testing, and removes the current blocker where new runner nodes cannot be added because assets live on local disk.

Desired outcome

- A consensus deployment plan for "launch now, scale later".
- A minimal target architecture for the first production-like rollout.
- A clear migration path from local uploads to shared object storage.
- Concrete rollout, verification, and risk guidance before later multi-runner scaling.

Known facts / evidence

- The current architecture separates frontend, backend API, PostgreSQL, tusd, runner, and FFmpeg at the conceptual level. See `docs/ARCHITECTURE.md`.
- The current local/prod-ish runtime path is Docker services `postgres`, `redis`, `tusd`, `runner` plus local or containerized backend. See `docs/operations/supervisor.md`.
- Current asset ingest is local-disk based: Docker Compose mounts `../backend/uploads:/app/uploads`, and tusd writes to `/app/uploads` with `-upload-dir /app/uploads`. See `docker/docker-compose.yml`.
- Asset records persist `storage_path` as a local path and stream helpers validate that the referenced file exists locally. See `backend/app/models/database.py`, `backend/app/services/assets/upload_service.py`, `backend/app/services/assets/service.py`, and `backend/app/services/streams/helpers.py`.
- Current multi-destination streaming uses a single FFmpeg process with `tee` + `fifo` and `attempt_recovery=1`, but not explicit `onfail=ignore`. See `backend/app/streaming/ffmpeg_manager.py`.
- The repo already documents future horizontal scaling, S3-compatible object storage, multiple runtime nodes, and MediaMTX as a later media-plane layer. See `docs/ARCHITECTURE.md` and `docs/operations/mediamtx.md`.

Constraints

- Keep the first production-ish solution simple enough to launch and test soon.
- Avoid premature distributed-system complexity.
- Preserve the current copy-first / no-transcode economics where possible.
- Planning only in this workflow; no source-code implementation handoff yet.

Unknowns / open questions

- Whether first launch should be one all-in-one server or split control-plane and media-plane onto two servers.
- Whether the first shared-storage step should target AWS S3 directly or self-hosted MinIO.
- Whether multi-destination failure isolation should be fixed before launch or explicitly accepted as an MVP risk.

Likely codebase touchpoints

- `docker/docker-compose.yml`
- `docs/ARCHITECTURE.md`
- `docs/operations/supervisor.md`
- `docs/operations/mediamtx.md`
- `backend/app/streaming/ffmpeg_manager.py`
- `backend/app/services/assets/upload_service.py`
- `backend/app/services/assets/service.py`
- `backend/app/services/streams/helpers.py`
- `backend/app/models/database.py`
