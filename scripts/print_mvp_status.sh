#!/usr/bin/env bash
set -euo pipefail

cat <<'EOF'
Final MVP contract

Supported MVP scope:
- single-node runtime: frontend, backend, postgres, redis, tusd
- single-destination streaming to one enabled YouTube RTMPS destination
- one real auth sanity check without DEV bypass before launch
- one first-stream rehearsal with stable running status and clean stop

Automated gates:
- make verify-mvp
- make verify-mvp-localdb

Required manual launch gates:
- real auth sanity check without NEXT_PUBLIC_DEV_BYPASS_AUTH
- first-stream rehearsal from docs/operations/first_stream_checklist.md

This remains a post-MVP rollout lane:
- host-native systemd production hardening in docs/operations/systemd.md
- public multi-destination readiness after a separate rehearsal lane

Core docs:
- docs/MVP_COMPLETE.md
- docs/TESTING.md
- docs/TROUBLESHOOTING.md
- docs/backend_api_contract.md
EOF
