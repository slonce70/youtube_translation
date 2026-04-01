---
name: product-polish-worker
description: Complete and harden user-facing web flows across auth, library, streaming, plans, and admin.
---

# Product Polish Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for features that change browser-visible product behavior: auth flows, dashboard shell, library UX, playlists, destinations, stream builder/live-edit surfaces, plans/quota messaging, and admin pages.

## Required Skills

- `agent-browser` — required whenever the feature changes a browser-visible flow. Use it after implementation to verify the full flow end-to-end on the running app.

## Work Procedure

1. Read `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, and `.factory/library/user-testing.md` before changing code.
2. Identify the exact user journey affected and the current tests covering it.
3. Add or update failing tests first:
   - Jest or React Testing Library for UI logic
   - backend tests as needed if the feature crosses the API boundary
4. Implement the smallest end-to-end change that makes the flow complete and coherent. Match existing component and service patterns.
5. Verify the changed flow manually with `agent-browser`. Every meaningful path tested must be recorded in `interactiveChecks`.
6. Run the relevant validators:
   - focused frontend and backend tests
   - `npm run lint`, `npm run type-check`, `npm test`, `npm run i18n:check` for touched frontend code
   - broader repo validators if the scope is cross-cutting
7. Ensure no placeholder UI remains for the targeted flow if the feature claims the validation assertion.

## Example Handoff

```json
{
  "salientSummary": "Completed the library rename and folder-targeted upload flow, plus fixed the stream-builder selection path so uploaded assets become immediately usable.",
  "whatWasImplemented": "Added failing tests for library rename persistence and folder-targeted upload visibility, updated the dashboard library state/actions to persist the new asset name and selected folder placement, and fixed the stream-builder asset selection path so the same uploaded asset appears without a manual refresh.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "cd frontend && npm test -- --runTestsByPath src/app/dashboard/library/__tests__/asset-view.test.ts",
        "exitCode": 0,
        "observation": "Focused library tests passed."
      },
      {
        "command": "cd frontend && npm run lint && npm run type-check && npm run i18n:check",
        "exitCode": 0,
        "observation": "Frontend static checks passed."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Uploaded an asset from a selected folder, renamed it, refreshed the page, and opened the stream builder.",
        "observed": "The asset stayed in the selected folder with the new name and was selectable immediately in the builder."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "frontend/src/app/dashboard/library/__tests__/asset-view.test.ts",
        "cases": [
          {
            "name": "renamed asset persists after reload",
            "verifies": "Library shows the updated asset title after a persisted rename."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature depends on a product decision not settled in the mission artifacts
- The browser flow cannot be validated because required local services or seed state are unavailable
- Fixing the issue would expand scope into a new product area not covered by the mission
