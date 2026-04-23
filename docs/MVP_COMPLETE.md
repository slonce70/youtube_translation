# Final MVP

## Supported Scope

The final MVP for this repository is intentionally narrow:

- single-node topology with `frontend`, `backend`, `postgres`, `redis`, and `tusd`
- one authenticated user flow
- one upload flow through tusd
- one compatible playlist
- one enabled YouTube RTMPS destination
- one stream start, stable `running` window, and clean stop

This is the smallest contract that we consider honestly shippable today.

## Automated Verification

Preferred entrypoints:

```bash
make verify-mvp
```

If local `postgres` and `redis` are already host-owned and you intentionally want to use them:

```bash
make verify-mvp-localdb
```

`verify-mvp` reuses the strict canonical engineering gate.
`verify-mvp-localdb` reuses the explicit local fallback without weakening the canonical path.

## Required Manual Launch Checks

Automated checks are not enough for the final MVP. Before calling the product launch-ready, run:

1. One real auth sanity check without `NEXT_PUBLIC_DEV_BYPASS_AUTH`
2. One complete rehearsal from `docs/operations/first_stream_checklist.md`
3. A quick manual smoke of `/dashboard`, `/admin`, library upload, stream start, stream stop, and logs

## Explicitly Outside Final MVP

These areas are available for later rollout, but they are not required for final MVP completion:

- host-native `systemd` production hardening
- public multi-destination readiness
- MediaMTX scale-up
- providers beyond YouTube

See `docs/operations/systemd.md` for the post-MVP Linux production lane.
