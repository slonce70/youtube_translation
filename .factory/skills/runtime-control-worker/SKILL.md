---
name: runtime-control-worker
description: Harden backend stream lifecycle, scheduler, reconciliation, and copy-first runtime behavior.
---

# Runtime Control Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for features that change backend stream lifecycle behavior, scheduler execution, reconciliation, status/log APIs, destination launch gating, copy-first runtime rules, and related runtime quota enforcement.

## Required Skills

None.

## Work Procedure

1. Read `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, `.factory/library/runtime.md`, and the feature description before touching code.
2. Identify the exact backend modules and tests involved; add or update failing backend tests first. Use focused pytest files for the target behavior.
3. Implement the smallest runtime/control-plane change that makes the new tests pass while preserving copy-first behavior and managed runtime assumptions.
4. If the feature changes an operator-visible API surface, verify it with `curl` against the local stack; if it changes a browser-visible stream surface, also perform one browser sanity check.
5. Run targeted backend validators first, then the broader required validators:
   - focused `pytest` files
   - `RUN_BLACK=1 make lint-backend`
   - `RUN_MYPY=1 make type-check`
   - relevant `curl` status/start/stop/quality/log checks
6. Do not leave orphan processes. If you start services manually for verification, stop only what you started.
7. If you discover the runtime baseline cannot be validated without changing mission boundaries, return to the orchestrator.

## Example Handoff

```json
{
  "salientSummary": "Hardened stream reconciliation and scheduled execution so running streams recover cleanly after API restart and due scheduled streams now start/stop on time.",
  "whatWasImplemented": "Added regression tests for scheduled start/stop execution and stale-heartbeat recovery, then updated the stream scheduler and reconciler paths so status converges to one authoritative state. Also tightened status payloads used by start/stop/recovery flows and verified the same stream record remains controllable after restart.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "cd backend && .venv/bin/python -m pytest tests/test_stream_scheduler.py tests/test_stream_reconciler.py -v",
        "exitCode": 0,
        "observation": "Targeted scheduler and reconciler regressions passed."
      },
      {
        "command": "RUN_BLACK=1 make lint-backend",
        "exitCode": 0,
        "observation": "Backend lint and Black check passed."
      },
      {
        "command": "RUN_MYPY=1 make type-check",
        "exitCode": 0,
        "observation": "Frontend and backend type checks passed."
      },
      {
        "command": "curl -sf http://localhost:8000/api/streams/<id>/status",
        "exitCode": 0,
        "observation": "Status reflected one coherent post-restart state for the tested stream."
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "backend/tests/test_stream_reconciler.py",
        "cases": [
          {
            "name": "stale heartbeat moves live stream into recoverable non-live state",
            "verifies": "Reconciler fails closed instead of leaving a ghost live stream."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A feature requires new product decisions about managed runtime versus manager fallback
- The necessary verification depends on credentials or infrastructure outside the mission boundaries
- The fix would require a broad architecture rewrite or a new background service not already approved
