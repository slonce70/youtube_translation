# Runtime

Runtime-specific guidance for V1 stabilization.

## V1 runtime baseline
- Preferred runtime mode for acceptance: **supervisor-managed runner**
- API process remains the control plane, not the long-lived FFmpeg host
- Manager fallback may exist for local development, but it is not the target product baseline

## Runtime invariants
- One stream record maps to one authoritative live/non-live state
- Start must fail closed on bad prerequisites
- Stop must be idempotent and clear phantom live state
- Scheduler execution must be observable through the same status/log surfaces users and admins rely on
- Reconciliation after API restart or stale heartbeat must leave the stream usable again

## Copy-first rules
- Treat `compatible_for_copy` and playlist validation as first-class gates
- If media is not ready for copy-first runtime, surface it clearly before launch
- Avoid broad runtime transcoding as a silent fallback path for V1 product behavior

## Operational caution points
- Suspension and force-stop must converge on real runtime state, not just DB row updates
- Daily streaming-hour limits can affect already-live streams; fail closed and surface the reason
- Do not rely on log-continuity details as the product invariant; rely on coherent status and control behavior
