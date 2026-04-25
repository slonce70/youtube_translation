"""End-to-end test for the MultiFernet rotation pipeline.

Sprint 1 introduced ``MultiFernet`` + ``rotate_record`` in
``core/security.py`` and the admin script ``scripts/rotate_encryption_keys.py``.
This module covers the round-trip:

  1. Encrypt a destination's stream key under key A (initial state).
  2. Re-init the global ``encryption`` object with primary=B,
     previous=[A] (mid-rotation state).
  3. Confirm decrypt() still works → MultiFernet falls through to A.
  4. Call rotate_record() to rewrap under B → produces new ciphertext.
  5. Re-init with primary=B, previous=[] (post-cleanup state).
  6. Confirm the new ciphertext decrypts; the OLD one does NOT.

This is the contract the runbook (`docs/runbooks/encryption_rotation.md`)
relies on. Phase 3 of the rotation procedure says "drop ENCRYPTION_KEY_PREVIOUS
once all rows are rewrapped"; if step 5 here fails, the runbook is wrong.
"""
from __future__ import annotations

import pytest
from cryptography.fernet import InvalidToken

from app.core.security import StreamKeyEncryption


SALT = b"e2e_rotation_16b"

KEY_A = "rotation-e2e-key-A-must-be-32-chars!"
KEY_B = "rotation-e2e-key-B-must-be-32-chars!"


def test_rotation_pipeline_round_trip():
    """Phase 0 → Phase 1 → Phase 2 → Phase 3 walk-through."""

    # Phase 0: only key A in use. Backend writes ciphertexts under A.
    cipher_a = StreamKeyEncryption(KEY_A, salt=SALT, previous_keys=[])
    plaintext = "rtmp-secret-key-12345"
    token_a = cipher_a.encrypt(plaintext)

    # Phase 1: operator deploys with primary=B, previous=[A].
    # Sanity: existing ciphertexts still decrypt.
    cipher_b_then_a = StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[KEY_A])
    assert cipher_b_then_a.decrypt(token_a) == plaintext

    # New ciphertexts written from this point are under B (because
    # MultiFernet.encrypt always uses fernets[0]).
    new_token = cipher_b_then_a.encrypt(plaintext)

    # The freshly-encrypted token is a B-cipher (rotation script will
    # produce equivalent output via rotate_record). Decrypts under [B, A].
    assert cipher_b_then_a.decrypt(new_token) == plaintext

    # Phase 2: rotation script rewraps each old token.
    rotated = cipher_b_then_a.rotate_record(token_a)
    # Sanity: the rotated token decrypts under primary-only.
    cipher_only_b = StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[])
    assert cipher_only_b.decrypt(rotated) == plaintext

    # Phase 3: operator drops ENCRYPTION_KEY_PREVIOUS, restarts.
    # The OLD ciphertext (token_a, written under A) MUST now fail.
    with pytest.raises(InvalidToken):
        cipher_only_b.decrypt(token_a)

    # The freshly-encrypted token from phase 1 still works (was written
    # under B, primary remains B).
    assert cipher_only_b.decrypt(new_token) == plaintext

    # The rotated token works (Phase 2 output is under B).
    assert cipher_only_b.decrypt(rotated) == plaintext


def test_rotation_handles_mixed_corpus():
    """Realistic case: some rows are pre-rotation (key A), some are
    post-Phase-1 (key B). The rotation script's job is to rewrap every
    A-encrypted row to B; this test simulates that."""

    cipher_a = StreamKeyEncryption(KEY_A, salt=SALT, previous_keys=[])
    cipher_b_then_a = StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[KEY_A])

    # Mixed corpus.
    rows = []
    for i in range(20):
        if i % 2 == 0:
            rows.append(("A", f"plain-{i}", cipher_a.encrypt(f"plain-{i}")))
        else:
            rows.append(("B", f"plain-{i}", cipher_b_then_a.encrypt(f"plain-{i}")))

    # All rows decrypt under the rotation-state cipher.
    for source, plain, ct in rows:
        assert cipher_b_then_a.decrypt(ct) == plain

    # Run rotation: rewrap every row (idempotent for B-rows).
    rewrapped = []
    for source, plain, ct in rows:
        rewrapped.append((source, plain, cipher_b_then_a.rotate_record(ct)))

    # Drop key A — every rewrapped token must now decrypt under primary-only.
    cipher_only_b = StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[])
    for source, plain, ct in rewrapped:
        assert cipher_only_b.decrypt(ct) == plain

    # And the originally-A tokens (NOT rewrapped) FAIL — the rotation
    # script's responsibility is to ensure no row is left behind.
    for source, plain, ct in rows:
        if source == "A":
            with pytest.raises(InvalidToken):
                cipher_only_b.decrypt(ct)


def test_rotation_idempotent():
    """Running rotate_record twice on the same input is safe."""

    cipher_a = StreamKeyEncryption(KEY_A, salt=SALT, previous_keys=[])
    cipher_b_then_a = StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[KEY_A])

    token_a = cipher_a.encrypt("idempotent-test")

    once = cipher_b_then_a.rotate_record(token_a)
    twice = cipher_b_then_a.rotate_record(once)

    # Both decrypt to the same plaintext.
    cipher_only_b = StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[])
    assert cipher_only_b.decrypt(once) == "idempotent-test"
    assert cipher_only_b.decrypt(twice) == "idempotent-test"


def test_rotation_rejects_truly_unknown_token():
    """rotate_record on a token from an unknown key must raise — the
    rotation script's `errors` counter increments and the row is left
    untouched."""

    cipher_b_then_a = StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[KEY_A])

    UNRELATED_KEY = "unrelated-key-32-chars-NOT-A-or-B!"
    cipher_unrelated = StreamKeyEncryption(UNRELATED_KEY, salt=SALT, previous_keys=[])
    foreign_token = cipher_unrelated.encrypt("foreign-data")

    with pytest.raises(InvalidToken):
        cipher_b_then_a.rotate_record(foreign_token)
