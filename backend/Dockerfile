# syntax=docker/dockerfile:1.6

# ---- Stage 1: builder ----
FROM python:3.12-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt .

RUN pip wheel --wheel-dir /wheels -r requirements.txt

# ---- Stage 2: runtime ----
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_HOME=/app \
    APP_UID=10001 \
    APP_GID=10001

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid ${APP_GID} app \
    && useradd --system --uid ${APP_UID} --gid ${APP_GID} \
        --home-dir ${APP_HOME} --shell /usr/sbin/nologin app

WORKDIR ${APP_HOME}

COPY --from=builder /wheels /wheels
COPY requirements.txt .
RUN pip install --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

COPY --chown=app:app app ./app
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app migrations ./migrations
COPY --chown=app:app apply_migrations.py ./apply_migrations.py
COPY --chown=app:app entrypoint.sh ./entrypoint.sh

RUN chmod +x entrypoint.sh \
    && mkdir -p ${APP_HOME}/uploads ${APP_HOME}/streams ${APP_HOME}/logs \
    && chown -R app:app ${APP_HOME}/uploads ${APP_HOME}/streams ${APP_HOME}/logs

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "./entrypoint.sh"]
