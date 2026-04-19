# Final MVP Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codify the final narrow MVP in the repository through explicit targets, executable status output, synced docs, and regression tests that prevent contract drift.

**Architecture:** Reuse the existing strict verification gates instead of inventing a new test stack. Add a thin MVP layer in `Makefile` and `scripts/`, then sync the documentation surface so the repo states one honest shipping contract. Protect that layer with small structural tests.

**Tech Stack:** GNU Make, bash, pytest, Markdown docs

---

### Task 1: Add failing contract tests for the new MVP layer

**Files:**
- Modify: `backend/tests/test_makefile_verification_targets.py`
- Create: `backend/tests/test_mvp_status_script.py`
- Create: `backend/tests/test_docs_contract.py`

- [ ] Add assertions for `mvp-status`, `verify-mvp`, and `verify-mvp-localdb`.
- [ ] Add a script test that expects the MVP status output to mention single-node, single-destination, real auth sanity, first-stream rehearsal, and the relevant doc paths.
- [ ] Add a docs contract test that fails while README points to missing docs.
- [ ] Run the focused pytest selection and confirm the new tests fail for the right reasons.

### Task 2: Implement the MVP entrypoints and executable status output

**Files:**
- Modify: `Makefile`
- Create: `scripts/print_mvp_status.sh`

- [ ] Add a terminal-friendly `mvp-status` target.
- [ ] Add `verify-mvp` that reuses `verify-v0` and then prints the MVP status.
- [ ] Add `verify-mvp-localdb` that reuses `verify-v0-localdb` and then prints the MVP status.
- [ ] Implement `scripts/print_mvp_status.sh` with zero side effects and clear file references.
- [ ] Run the focused pytest selection and confirm the new tests pass.

### Task 3: Ship the missing docs and align the repo around the final MVP scope

**Files:**
- Modify: `README.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/backend_api_map.md`
- Modify: `docs/operations/first_stream_checklist.md`
- Modify: `docs/operations/systemd.md`
- Create: `docs/MVP_COMPLETE.md`
- Create: `docs/IMPLEMENTATION_REPORT.md`
- Create: `docs/TROUBLESHOOTING.md`
- Create: `docs/backend_api_contract.md`

- [ ] Create the missing docs referenced by README.
- [ ] Update README to point to the real docs and the new MVP targets.
- [ ] Update testing and operations docs so MVP means single-node, single-destination, real auth sanity, and first-stream rehearsal.
- [ ] Reframe `systemd` and multi-destination as post-MVP rollout lanes rather than MVP blockers.
- [ ] Run the focused doc-contract pytest selection and confirm it passes.

### Task 4: Run the final MVP verification bar

**Files:**
- Verify only

- [ ] Run the focused regression tests for the new contract layer.
- [ ] Run `make verify-mvp-localdb`.
- [ ] Review the resulting repo diff for accidental scope creep.
- [ ] Commit the finished tranche with the MVP contract and docs synced.
