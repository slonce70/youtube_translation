"""Tests for MultiFernet-based encryption-key rotation.

Covers the contract that ``backend/scripts/rotate_encryption_keys.py`` and the
runbook in ``docs/runbooks/encryption_rotation.md`` rely on:

1. A token written under key A is still decryptable under
   ``MultiFernet([B, A])`` after rotation.
2. A token written under key A is **not** decryptable under
   ``MultiFernet([B])`` once the previous key has been removed.
3. ``rotate_record`` rewraps a token from a previous key under the new
   primary, and the result is decryptable by ``MultiFernet([B])`` alone.
4. Rotation handles the ``encryption_key_previous`` env via
   ``_parse_previous_keys``.
"""
from __future__ import annotations

import pytest
from cryptography.fernet import InvalidToken

from app.core.security import StreamKeyEncryption, _parse_previous_keys


SALT = b"rotation_test_16"


KEY_A = "rotation-key-A-must-be-32-chars!"
KEY_B = "rotation-key-B-must-be-32-chars!"
KEY_C = "rotation-key-C-must-be-32-chars!"


@pytest.fixture
def cipher_a() -> StreamKeyEncryption:
    return StreamKeyEncryption(KEY_A, salt=SALT, previous_keys=[])


@pytest.fixture
def cipher_b_then_a() -> StreamKeyEncryption:
    """Primary=B, previous=[A] — the post-rotation deployment state."""
    return StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[KEY_A])


@pytest.fixture
def cipher_only_b() -> StreamKeyEncryption:
    """Primary=B with no previous keys — the post-cleanup state."""
    return StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[])


def test_decrypt_old_token_under_new_chain(
    cipher_a: StreamKeyEncryption,
    cipher_b_then_a: StreamKeyEncryption,
) -> None:
    """A token encrypted under A must decrypt under MultiFernet([B, A])."""
    plaintext = "rtmp-key-old-record"
    token = cipher_a.encrypt(plaintext)

    assert cipher_b_then_a.decrypt(token) == plaintext


def test_decrypt_old_token_after_previous_dropped_fails(
    cipher_a: StreamKeyEncryption,
    cipher_only_b: StreamKeyEncryption,
) -> None:
    """Once previous key A is removed, A-encrypted tokens MUST fail to decrypt.

    This is the downgrade-attack/rotation-completion guarantee — if it
    silently passed, the rotation would be observed as complete while old
    keys still implicitly worked.
    """
    plaintext = "rtmp-key-stale"
    token = cipher_a.encrypt(plaintext)

    with pytest.raises(InvalidToken):
        cipher_only_b.decrypt(token)


def test_rotate_record_rewraps_under_primary(
    cipher_a: StreamKeyEncryption,
    cipher_b_then_a: StreamKeyEncryption,
    cipher_only_b: StreamKeyEncryption,
) -> None:
    """``rotate_record`` produces a token decryptable by primary alone."""
    plaintext = "rtmp-key-to-rotate"
    old_token = cipher_a.encrypt(plaintext)

    new_token = cipher_b_then_a.rotate_record(old_token)

    # Rotated token decrypts under primary-only chain (rotation complete).
    assert cipher_only_b.decrypt(new_token) == plaintext

    # Sanity: the rotated token differs from the original.
    assert new_token != old_token


def test_rotate_record_idempotent_on_primary_token(
    cipher_b_then_a: StreamKeyEncryption,
    cipher_only_b: StreamKeyEncryption,
) -> None:
    """Calling rotate_record on a token already under primary still decrypts."""
    plaintext = "already-under-primary"
    fresh_token = cipher_b_then_a.encrypt(plaintext)

    rotated = cipher_b_then_a.rotate_record(fresh_token)

    # Token may differ (rotate emits a fresh ciphertext) but must still decrypt
    # under primary-only.
    assert cipher_only_b.decrypt(rotated) == plaintext


def test_invalid_token_raises_on_decrypt(cipher_b_then_a: StreamKeyEncryption) -> None:
    """Garbled ciphertext must raise InvalidToken (not silently misparse)."""
    with pytest.raises(InvalidToken):
        cipher_b_then_a.decrypt("not-a-real-token")


def test_rotate_record_rejects_unknown_token(
    cipher_only_b: StreamKeyEncryption,
) -> None:
    """rotate_record on a token unreadable by any key must raise."""
    with pytest.raises(InvalidToken):
        cipher_only_b.rotate_record("not-a-real-token")


def test_parse_previous_keys_handles_csv_and_whitespace() -> None:
    assert _parse_previous_keys(None) == []
    assert _parse_previous_keys("") == []
    assert _parse_previous_keys("alpha") == ["alpha"]
    assert _parse_previous_keys("alpha,bravo") == ["alpha", "bravo"]
    assert _parse_previous_keys("  alpha , bravo  ,") == ["alpha", "bravo"]
    assert _parse_previous_keys(",,") == []


def test_chain_of_three_keys_decrypts_all_predecessors() -> None:
    """A real-world double rotation: token under A still readable under [C, B, A]."""
    cipher_a = StreamKeyEncryption(KEY_A, salt=SALT, previous_keys=[])
    cipher_b_then_a = StreamKeyEncryption(KEY_B, salt=SALT, previous_keys=[KEY_A])
    cipher_c_then_b_a = StreamKeyEncryption(KEY_C, salt=SALT, previous_keys=[KEY_B, KEY_A])

    token_a = cipher_a.encrypt("from-A")
    token_b = cipher_b_then_a.encrypt("from-B")

    assert cipher_c_then_b_a.decrypt(token_a) == "from-A"
    assert cipher_c_then_b_a.decrypt(token_b) == "from-B"
