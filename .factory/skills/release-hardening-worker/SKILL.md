---
name: release-hardening-worker
description: Harden scripts, ports, test harnesses, and deployment-facing config for the approved V1 baseline.
---

# Release Hardening Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for features that change startup scripts, local ports, Playwright/dev-server assumptions, Docker Compose/deployment wiring, and other release-facing infrastructure in the repo itself.

## Required Skills

- `agent-browser` — use when a release-hardening change affects browser reachability or end-to-end test boot.

## Work Procedure

1. Read `mission.md`, `AGENTS.md`, `.factory/services.yaml`, `.factory/library/environment.md`, and `.factory/library/user-testing.md` first.
2. Confirm the exact command/service path that needs to be stabilized before editing scripts or config.
3. Add or update failing tests or scripted checks first when the repo already has a relevant harness, especially Playwright or startup-related checks.
4. Implement the configuration/script change with minimal scope. Preserve the approved port and service boundaries, especially frontend `3100` and backend `8000`.
5. Verify startup and test harness behavior explicitly:
   - start affected services
   - run the relevant lint/type/test commands
   - run `cd frontend && PORT=3100 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run test:e2e` when e2e boot is affected
6. Stop only the processes you started. No orphan dev servers.
7. If a change would require altering mission boundaries or touching an off-limits external service, return to the orchestrator.

## Example Handoff

```json
{
  "salientSummary": "Shifted the local frontend/e2e baseline to port 3100 and aligned the Playwright and startup scripts with the mission environment.",
  "whatWasImplemented": "Updated the frontend startup and Playwright configuration to honor the mission port shift away from 3000, ensured the backend/frontend URLs remain aligned in local development, and verified that the browser test harness no longer reuses the unrelated app already running on port 3000.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "cd frontend && PORT=3100 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run test:e2e",
        "exitCode": 0,
        "observation": "Playwright used the mission app on port 3100 instead of the unrelated port-3000 app."
      },
      {
        "command": "RUN_BLACK=1 RUN_MYPY=1 PORT=3100 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 make verify-v0",
        "exitCode": 0,
        "observation": "Strict local release gate passed under mission port settings."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened the app at http://127.0.0.1:3100 after the script/config changes.",
        "observed": "The correct mission frontend loaded and routed to dashboard/login as expected."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "frontend/playwright.config.ts",
        "cases": [
          {
            "name": "web server honors mission base URL and port settings",
            "verifies": "E2E boot targets the mission frontend instead of any unrelated app on port 3000."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required verification depends on infrastructure outside the approved one-VPS baseline
- A requested change would force broad deployment-scope expansion, such as multi-node infrastructure or new managed services
- The repo's current startup assumptions are incompatible with the mission boundaries and require a planning change
