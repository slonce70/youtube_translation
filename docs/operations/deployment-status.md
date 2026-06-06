# Deployment Status

Date: 2026-06-06

## Current repository state

`.github/workflows/deploy-vps.yml` exists and currently declares push-to-main, hourly schedule, and manual triggers.

## Operational risk

Earlier operational context said the VPS autodeploy path was obsolete. Because the current checkout still contains the workflow, automatic deploys are quarantined to manual dispatch until production ownership is revalidated.

## Revalidation commands

```bash
gh workflow list
gh run list --workflow "Deploy VPS" --limit 20
gh secret list
```

If the VPS path is current, restore the required automatic triggers in a separate deployment PR with fresh production sign-off. If it is obsolete, delete the workflow and stale deploy scripts in a separate cleanup PR.
