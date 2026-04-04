#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path

VARIANTS = {
    "docker": {
        "__VARIANT__": "docker",
        "__PRIMARY_SITE__": "yourdomain.com",
        "__PRIMARY_BACKEND_UPSTREAM__": "backend:8000",
        "__PRIMARY_TUSD_UPSTREAM__": "tusd:1080",
        "__PRIMARY_FRONTEND_UPSTREAM__": "frontend:3000",
        "__PRIMARY_HSTS_LINE__": 'Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"',
        "__PRIMARY_LOG_BLOCK__": 'log {\n        output file /var/log/caddy/access.log\n    }',
        "__SECONDARY_SITE__": ":80",
        "__SECONDARY_BACKEND_UPSTREAM__": "backend:8000",
        "__SECONDARY_TUSD_UPSTREAM__": "tusd:1080",
        "__SECONDARY_FRONTEND_UPSTREAM__": "frontend:3000",
        "__SECONDARY_HSTS_LINE__": "",
        "__SECONDARY_LOG_BLOCK__": "",
    },
    "host": {
        "__VARIANT__": "host",
        "__PRIMARY_SITE__": "vps-d4ce4beb.vps.ovh.net",
        "__PRIMARY_BACKEND_UPSTREAM__": "127.0.0.1:8000",
        "__PRIMARY_TUSD_UPSTREAM__": "127.0.0.1:1080",
        "__PRIMARY_FRONTEND_UPSTREAM__": "127.0.0.1:3000",
        "__PRIMARY_HSTS_LINE__": 'Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"',
        "__PRIMARY_LOG_BLOCK__": "",
        "__SECONDARY_SITE__": "http://51.75.65.6",
        "__SECONDARY_BACKEND_UPSTREAM__": "127.0.0.1:8000",
        "__SECONDARY_TUSD_UPSTREAM__": "127.0.0.1:1080",
        "__SECONDARY_FRONTEND_UPSTREAM__": "127.0.0.1:3000",
        "__SECONDARY_HSTS_LINE__": "",
        "__SECONDARY_LOG_BLOCK__": "",
    },
}

ENV_OVERRIDES = {
    "__PRIMARY_SITE__": "CADDY_PRIMARY_SITE",
    "__SECONDARY_SITE__": "CADDY_FALLBACK_SITE",
    "__PRIMARY_BACKEND_UPSTREAM__": "CADDY_BACKEND_UPSTREAM",
    "__PRIMARY_TUSD_UPSTREAM__": "CADDY_TUSD_UPSTREAM",
    "__PRIMARY_FRONTEND_UPSTREAM__": "CADDY_FRONTEND_UPSTREAM",
    "__SECONDARY_BACKEND_UPSTREAM__": "CADDY_BACKEND_UPSTREAM",
    "__SECONDARY_TUSD_UPSTREAM__": "CADDY_TUSD_UPSTREAM",
    "__SECONDARY_FRONTEND_UPSTREAM__": "CADDY_FRONTEND_UPSTREAM",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Render Caddy config variants from a shared git-managed template.")
    parser.add_argument("--variant", choices=sorted(VARIANTS), required=True, help="Config variant to render")
    parser.add_argument("--template", required=True, help="Path to the template file")
    parser.add_argument("--output", required=True, help="Where to write the rendered config")
    args = parser.parse_args()

    rendered = Path(args.template).read_text(encoding="utf-8")
    values = dict(VARIANTS[args.variant])
    for token, env_name in ENV_OVERRIDES.items():
        if env_name in os.environ and os.environ[env_name]:
            values[token] = os.environ[env_name]

    for token, value in values.items():
        rendered = rendered.replace(token, value)

    Path(args.output).write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
