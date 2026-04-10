from __future__ import annotations

import argparse

import uvicorn

from app.core.config import settings
from app.core.uvicorn_config import build_uvicorn_run_kwargs


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the backend API with project defaults."
    )
    parser.add_argument("--host", default=settings.api_host)
    parser.add_argument("--port", type=int, default=settings.api_port)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--log-level", default="info")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    uvicorn.run(
        "app.main:app",
        **build_uvicorn_run_kwargs(
            host=args.host,
            port=args.port,
            reload=args.reload,
            log_level=args.log_level,
        ),
    )


if __name__ == "__main__":
    main()
