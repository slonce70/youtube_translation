"""Stream-key and provider-secret encryption with MultiFernet rotation.

Encryption is performed by ``MultiFernet`` so that a sequence of keys can be
configured: the primary key is used for new ciphertexts, and any previous key
remains available for decryption until ``rotate_record`` re-encrypts the
existing token under the primary. This enables online key rotation without
downtime — see ``backend/scripts/rotate_encryption_keys.py``.

Configuration (env):
* ``ENCRYPTION_KEY`` — primary key, required.
* ``ENCRYPTION_KEY_PREVIOUS`` — optional, comma-separated list of previous keys.
* ``ENCRYPTION_SALT`` — PBKDF2 salt (must be changed outside ``development``).
"""

from __future__ import annotations

import base64
import logging
from typing import List, Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.core.config import settings

logger = logging.getLogger(__name__)

_PBKDF2_ITERATIONS = 100_000


def _derive_fernet_key(secret: str, salt: bytes) -> bytes:
    """Derive a 32-byte Fernet key from ``secret`` using PBKDF2-HMAC-SHA256."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=_PBKDF2_ITERATIONS,
        backend=default_backend(),
    )
    return base64.urlsafe_b64encode(kdf.derive(secret.encode()))


def _parse_previous_keys(previous: Optional[str]) -> List[str]:
    if not previous:
        return []
    return [key.strip() for key in previous.split(",") if key.strip()]


class StreamKeyEncryption:
    """MultiFernet-backed encryption for sensitive provider secrets.

    The first Fernet in the chain (built from the primary key) is the
    *encryption* key — ``MultiFernet.encrypt`` uses ``self._fernets[0]``.
    Decryption is attempted against each Fernet in order until one succeeds,
    so ciphertexts written under any previous key can still be read.
    """

    def __init__(
        self,
        encryption_key: str,
        salt: Optional[bytes] = None,
        previous_keys: Optional[List[str]] = None,
    ) -> None:
        if salt is None:
            salt = settings.encryption_salt.encode()

        if previous_keys is None:
            previous_keys = _parse_previous_keys(settings.encryption_key_previous)

        self._primary_key = _derive_fernet_key(encryption_key, salt)
        self._previous_keys = [_derive_fernet_key(key, salt) for key in previous_keys]

        fernets = [Fernet(self._primary_key)] + [
            Fernet(key) for key in self._previous_keys
        ]
        self._fernets = fernets
        self._cipher = MultiFernet(fernets)

        if previous_keys:
            logger.info(
                "stream-key encryption initialized with %d previous key(s) for rotation",
                len(previous_keys),
            )

    # Backwards-compat: old code referenced `.cipher` directly.
    @property
    def cipher(self) -> MultiFernet:
        return self._cipher

    def encrypt(self, stream_key: str) -> str:
        """Encrypt a sensitive provider value under the *primary* key."""
        try:
            encrypted = self._cipher.encrypt(stream_key.encode())
            return encrypted.decode()
        except Exception as e:  # noqa: BLE001
            logger.error("Error encrypting stream key: %s", e)
            raise

    def decrypt(self, encrypted_key: str) -> str:
        """Decrypt a sensitive provider value, trying primary then previous keys."""
        try:
            decrypted = self._cipher.decrypt(encrypted_key.encode())
            return decrypted.decode()
        except InvalidToken:
            logger.error(
                "Failed to decrypt token: not valid under primary or any previous key"
            )
            raise
        except Exception as e:  # noqa: BLE001
            logger.error("Error decrypting stream key: %s", e)
            raise

    def rotate_record(self, encrypted_key: str) -> str:
        """Re-encrypt a token under the primary key.

        Used by the rotation script to migrate ciphertexts from a previous key
        to the new primary. Returns the new ciphertext. If the token is
        already under the primary key, ``MultiFernet.rotate`` is a no-op
        (returns equivalent ciphertext).
        """
        try:
            rotated = self._cipher.rotate(encrypted_key.encode())
            return rotated.decode()
        except InvalidToken:
            logger.error(
                "Cannot rotate token: not valid under primary or any previous key"
            )
            raise

    @staticmethod
    def mask_key(stream_key: str, show_chars: int = 4) -> str:
        """Mask stream key for display in UI (``****abcd`` style)."""
        if len(stream_key) <= show_chars:
            return "*" * len(stream_key)

        visible_part = stream_key[-show_chars:]
        masked_part = "*" * (min(12, len(stream_key) - show_chars))

        return f"{masked_part}{visible_part}"


# Global instance initialized with settings (primary + any previous keys).
encryption = StreamKeyEncryption(settings.encryption_key)


def encrypt_stream_key(key: str) -> str:
    """Encrypt a stream key under the primary encryption key."""
    return encryption.encrypt(key)


def decrypt_stream_key(encrypted_key: str) -> str:
    """Decrypt a stream key, transparently using previous keys when needed."""
    return encryption.decrypt(encrypted_key)


def mask_stream_key(key: str) -> str:
    """Mask a stream key for safe display in the UI."""
    return encryption.mask_key(key)


def encrypt_secret(value: str) -> str:
    """Encrypt a generic provider secret/token under the primary key."""
    return encryption.encrypt(value)


def decrypt_secret(value: str) -> str:
    """Decrypt a generic provider secret/token (rotation-aware)."""
    return encryption.decrypt(value)


def rotate_encrypted_value(value: str) -> str:
    """Re-encrypt a token under the primary key (rotation helper)."""
    return encryption.rotate_record(value)
