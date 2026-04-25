# Runbook — Encryption-key rotation

This runbook describes how to rotate `ENCRYPTION_KEY` (the master secret that
guards `destinations.stream_key_encrypted` and YouTube OAuth tokens) without
losing access to existing ciphertexts and without downtime.

The cryptographic primitive is **MultiFernet**: the application keeps a
chain of keys and *encrypts* under the primary while accepting decryption
under any previous key. Rotation therefore proceeds in four phases:

1. Generate a new primary key.
2. Deploy the new primary alongside the old key as a *previous* key.
3. Re-encrypt every stored ciphertext under the new primary
   (`scripts/rotate_encryption_keys.py`).
4. Drop the previous key from the env and restart.

The system is online for the entire procedure. There is no flag-cutover and
no client-visible downtime.

## When to rotate

* Suspected key compromise (leak, shared key history, departing operator with
  access to historical secrets).
* Scheduled rotation per security policy (annual is a reasonable default).
* Migration to a new HSM/KMS-managed key.

If the key has been **confirmed compromised**, treat this as an incident and
escalate per the incident-response runbook before starting rotation — you
should also rotate every downstream RTMP stream key with the YouTube/RTMPS
provider, not just the encryption-of-encryption key.

## Pre-flight

```
# 1. Generate the new primary key (32 url-safe-base64 bytes).
python -c 'import secrets; print(secrets.token_urlsafe(32))' | tee new-encryption-key.txt
# Treat the output as a high-grade secret. Place it in your secret manager.

# 2. Confirm a recent backup exists. The rotation only modifies the
#    encrypted columns; a fresh backup gives a clean recovery point.
./scripts/backup_postgres.sh   # (lands in Sprint 4 — until then take pg_dump manually)
```

## Procedure

### Phase 1 — Deploy with both keys

1. Update the production env so that the old key becomes the *previous* key
   and the new key becomes the primary:

   ```
   ENCRYPTION_KEY=<NEW>
   ENCRYPTION_KEY_PREVIOUS=<OLD>
   ```

   (`ENCRYPTION_KEY_PREVIOUS` accepts a comma-separated list, so you can keep
   multiple historical keys during a multi-step rotation.)

2. Restart the backend so the new env is picked up. New ciphertexts written
   from this moment are under the new primary; old ciphertexts continue to
   decrypt against `ENCRYPTION_KEY_PREVIOUS`.

3. Smoke check:

   ```
   curl -fsS http://localhost:8000/healthz   # process up
   curl -fsS http://localhost:8000/readyz    # DB + Redis reachable
   # Trigger a destination read in the dashboard — masked key returns OK.
   ```

### Phase 2 — Rewrap stored ciphertexts

```
# Dry-run first; this reads every encrypted column, simulates the rewrap, and
# rolls the transaction back so nothing changes.
python -m scripts.rotate_encryption_keys --dry-run --verbose

# Inspect the SUMMARY line:
#   ROTATION SUMMARY: scanned=N rewritten=M errors=0 (dry_run=True)
# `errors` MUST be 0. If non-zero, abort and investigate before continuing.

# Apply for real:
python -m scripts.rotate_encryption_keys
```

The script is idempotent. A crash mid-rotation leaves the database in a
mixed state, but ciphertexts not yet rewrapped still decrypt under the
previous key. Re-running the script picks up where it left off.

### Phase 3 — Drop the previous key

1. Verify all rows have been rewrapped:

   ```
   python -m scripts.rotate_encryption_keys --dry-run
   # SUMMARY should report `rewritten=0`.
   ```

2. Remove `ENCRYPTION_KEY_PREVIOUS` from the production env.
3. Restart the backend.
4. Final smoke check (same as Phase 1, step 3).

### Phase 4 — Cleanup

* Move the old key into the secrets archive or destroy it per policy.
* Update the rotation log (date, operator, reason).
* If this rotation was incident-driven, link the incident ticket here.

## Rollback

If Phase 1 or Phase 2 misbehaves:

* **Phase 1 issue (backend won't start)**: revert env to the old primary
  alone, restart. Investigate before retrying.
* **Phase 2 partial failure**: do not roll back. The old key is still
  configured, so all data remains readable. Re-run the rotation script.
* **Phase 3 too eager (dropped previous key while data still under old)**:
  re-add the old key as `ENCRYPTION_KEY_PREVIOUS`, restart, re-run Phase 2.

## Verification

After rotation, the following must all be true:

```
# 1. Backend up.
curl -fsS http://localhost:8000/readyz

# 2. Stream-key encrypt/decrypt round-trip works in tests:
pytest backend/tests/test_security_rotation.py -v

# 3. Active streams continue running. (Stream keys are decrypted on stream
#    start, not per-frame, so a key rotation never interrupts an active
#    stream — but verify anyway.)
psql "$DATABASE_URL" -c "SELECT id, status FROM streams WHERE status = 'running';"
```

## Related

* `backend/app/core/security.py` — `MultiFernet` integration.
* `backend/scripts/rotate_encryption_keys.py` — rewrap script.
* `backend/tests/test_security_rotation.py` — round-trip tests.
