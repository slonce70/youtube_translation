# Final MVP Contract Design

**Date:** 2026-04-19

**Goal**

Close the project as a narrow, honest MVP by codifying one supported launch path in the repository itself: single-node deployment, single-destination streaming, one real auth sanity check, and one stable first-stream rehearsal. Everything beyond that remains available for future rollout, but not part of the MVP definition of done.

## Recommended MVP Boundary

The supported MVP path is:

- one node running `frontend`, `backend`, `postgres`, `redis`, and `tusd`
- stream execution through the supported runtime for the lane: backend-managed `manager` locally, or post-MVP host-native `systemd` stream units
- one authenticated user
- one upload flow through tusd
- one compatible playlist
- one enabled YouTube RTMPS destination
- one stream start, stable `running` period, and clean stop

The following are intentionally outside the final MVP contract:

- `systemd` host-native production hardening as a required launch bar
- public multi-destination readiness
- MediaMTX-based scale-up
- providers beyond YouTube

Those areas can still exist in the codebase, but they should be documented as post-MVP rollout lanes rather than required pre-launch work.

## Architecture

The implementation should not add another large subsystem. Instead, it should add a thin MVP contract layer on top of the now-stable codebase:

1. make the final MVP scope explicit in docs
2. make the release entrypoint explicit in `Makefile`
3. make the repository self-check for doc drift and MVP target drift

This keeps the project practical. We are not changing the streaming engine again; we are making the shipping contract clear, testable, and hard to misread.

## Required Repository Changes

### 1. Explicit MVP verification entrypoints

Add a small `Makefile` surface for the final MVP:

- `make mvp-status`
- `make verify-mvp`
- `make verify-mvp-localdb`

`verify-mvp` should reuse the strict canonical gate via `verify-v0`.
`verify-mvp-localdb` should reuse the explicit local fallback via `verify-v0-localdb`.
Both should end by printing the same MVP scope and the remaining manual launch checks.

### 2. Executable MVP status output

Add a small script under `scripts/` that prints:

- the supported MVP scope
- the automated gate names
- the required manual gates
- the doc paths that define the first-stream and post-MVP lanes

This gives operators and developers one clear terminal-friendly summary instead of scattering the final contract across multiple files.

### 3. Close documentation drift

The current README advertises core docs that do not exist. The repository should ship the docs it references:

- `docs/MVP_COMPLETE.md`
- `docs/IMPLEMENTATION_REPORT.md`
- `docs/TROUBLESHOOTING.md`
- `docs/backend_api_contract.md`

Existing docs should also be updated so they consistently describe:

- final MVP scope
- `verify-mvp` / `verify-mvp-localdb`
- `systemd` as a post-MVP rollout lane, not an MVP blocker
- multi-destination as post-MVP public readiness

### 4. Regression tests for the contract

Add lightweight tests that fail if we regress:

- Makefile target drift for the new MVP targets
- missing output or path references in the MVP status script
- missing README-linked docs

These tests are intentionally small and structural. Their job is to protect the shipping contract from future drift.

## Verification Strategy

The final tranche should be considered complete only after fresh evidence for:

- focused regression tests for new MVP targets and script behavior
- the relevant doc-contract tests
- `make verify-mvp-localdb`

If environment constraints prevent the canonical compose-owned gate, we should still leave `verify-mvp` intact and green-by-contract, while using `verify-mvp-localdb` as the explicitly documented local fallback.

## Expected Outcome

After this tranche:

- the repo has one obvious final MVP definition
- the repo has one obvious verification command for that MVP
- README no longer points to missing artifacts
- the remaining manual launch work is clearly documented instead of implied

That is the smallest practical move from "stabilized codebase" to "finished MVP contract."
