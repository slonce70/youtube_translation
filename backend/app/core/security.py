from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
from cryptography.hazmat.backends import default_backend
import base64
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class StreamKeyEncryption:
    """Handle encryption/decryption of YouTube stream keys"""
    
    def __init__(self):
        # Derive key from SECRET_KEY
        kdf = PBKDF2(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'youtube_streaming_salt',  # In production, use random salt per project
            iterations=100000,
            backend=default_backend()
        )
        key = base64.urlsafe_b64encode(kdf.derive(settings.encryption_key.encode()))
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


# Global instance
encryption = StreamKeyEncryption()


def encrypt_stream_key(key: str) -> str:
    """Helper function to encrypt stream key"""
    return encryption.encrypt(key)


def decrypt_stream_key(encrypted_key: str) -> str:
    """Helper function to decrypt stream key"""
    return encryption.decrypt(encrypted_key)


def mask_stream_key(key: str) -> str:
    """Helper function to mask stream key"""
    return encryption.mask_key(key)
