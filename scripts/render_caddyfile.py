#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path

DEFAULTS = {
    "__PRIMARY_SITE__": "vps-d4ce4beb.vps.ovh.net",
    "__FALLBACK_SITE__": "http://51.75.65.6",
    "__BACKEND_UPSTREAM__": "127.0.0.1:8000",
    "__TUSD_UPSTREAM__": "127.0.0.1:1080",
    "__FRONTEND_UPSTREAM__": "127.0.0.1:3000",
}

ENV_MAP = {
    "__PRIMARY_SITE__": "CADDY_PRIMARY_SITE",
    "__FALLBACK_SITE__": "CADDY_FALLBACK_SITE",
    "__BACKEND_UPSTREAM__": "CADDY_BACKEND_UPSTREAM",
    "__TUSD_UPSTREAM__": "CADDY_TUSD_UPSTREAM",
    "__FRONTEND_UPSTREAM__": "CADDY_FRONTEND_UPSTREAM",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Render the host Caddyfile from a git-managed template.")
    parser.add_argument("--template", required=True, help="Path to the Caddyfile template")
    parser.add_argument("--output", required=True, help="Where to write the rendered Caddyfile")
    args = parser.parse_args()

    template_path = Path(args.template)
    output_path = Path(args.output)

    rendered = template_path.read_text(encoding="utf-8")
    for token, default in DEFAULTS.items():
        rendered = rendered.replace(token, os.environ.get(ENV_MAP[token], default))

    output_path.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
