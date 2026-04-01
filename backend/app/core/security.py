from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend
import base64
import logging
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class StreamKeyEncryption:
    """Handle encryption/decryption of YouTube stream keys"""

    def __init__(self, encryption_key: str, salt: Optional[bytes] = None):
        """
        Initialize encryption with key and salt from settings.

        Args:
            encryption_key: Base encryption key from settings
            salt: Optional salt, uses settings.encryption_salt if not provided
        """
        # Use environment-specific salt
        if salt is None:
            salt = settings.encryption_salt.encode()

        # Derive key from ENCRYPTION_KEY and salt
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend(),
        )
        key = base64.urlsafe_b64encode(kdf.derive(encryption_key.encode()))
        self.cipher = Fernet(key)

    def encrypt(self, stream_key: str) -> str:
        """
        Encrypt YouTube stream key.

        Args:
            stream_key: Plain text stream key

        Returns:
            Base64 encoded encrypted key
        """
        try:
            encrypted = self.cipher.encrypt(stream_key.encode())
            return encrypted.decode()
        except Exception as e:
            logger.error(f"Error encrypting stream key: {e}")
            raise

    def decrypt(self, encrypted_key: str) -> str:
        """
        Decrypt YouTube stream key.

        Args:
            encrypted_key: Base64 encoded encrypted key

        Returns:
            Plain text stream key
        """
        try:
            decrypted = self.cipher.decrypt(encrypted_key.encode())
            return decrypted.decode()
        except Exception as e:
            logger.error(f"Error decrypting stream key: {e}")
            raise

    @staticmethod
    def mask_key(stream_key: str, show_chars: int = 4) -> str:
        """
        Mask stream key for display in UI.

        Args:
            stream_key: Plain or encrypted stream key
            show_chars: Number of characters to show at the end

        Returns:
            Masked key like "****-****-abcd"
        """
        if len(stream_key) <= show_chars:
            return "*" * len(stream_key)

        visible_part = stream_key[-show_chars:]
        masked_part = "*" * (min(12, len(stream_key) - show_chars))

        return f"{masked_part}{visible_part}"


# Global instance initialized with settings
encryption = StreamKeyEncryption(settings.encryption_key)


def encrypt_stream_key(key: str) -> str:
    """Helper function to encrypt stream key"""
    return encryption.encrypt(key)


def decrypt_stream_key(encrypted_key: str) -> str:
    """Helper function to decrypt stream key"""
    return encryption.decrypt(encrypted_key)


def mask_stream_key(key: str) -> str:
    """Helper function to mask stream key"""
    return encryption.mask_key(key)
