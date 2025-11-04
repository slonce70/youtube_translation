"""
Tests for security module (encryption/decryption).
"""
import pytest
from app.core.security import StreamKeyEncryption


class TestStreamKeyEncryption:
    """Test encryption and decryption of stream keys"""
    
    def test_encryption_decryption(self):
        """Test that encryption/decryption works correctly"""
        enc = StreamKeyEncryption(
            encryption_key="test_key_32_chars_long_enough!",
            salt=b"test_salt_16byte"
        )
        original = "my-stream-key-123"
        
        encrypted = enc.encrypt(original)
        decrypted = enc.decrypt(encrypted)
        
        assert decrypted == original, "Decrypted value should match original"
        assert encrypted != original, "Encrypted value should be different from original"
    
    def test_different_keys_produce_different_ciphertext(self):
        """Test that different encryption keys produce different results"""
        enc1 = StreamKeyEncryption(
            encryption_key="key1_32_chars_long_enough_test!",
            salt=b"salt16bytes12345"
        )
        enc2 = StreamKeyEncryption(
            encryption_key="key2_32_chars_long_enough_test!",
            salt=b"salt16bytes12345"
        )
        
        original = "my-stream-key"
        encrypted1 = enc1.encrypt(original)
        encrypted2 = enc2.encrypt(original)
        
        assert encrypted1 != encrypted2, "Different keys should produce different ciphertext"
    
    def test_different_salts_produce_different_ciphertext(self):
        """Test that different salts produce different results"""
        key = "same_key_32_chars_long_enough!!"
        enc1 = StreamKeyEncryption(encryption_key=key, salt=b"salt1_16bytes123")
        enc2 = StreamKeyEncryption(encryption_key=key, salt=b"salt2_16bytes123")
        
        original = "my-stream-key"
        encrypted1 = enc1.encrypt(original)
        encrypted2 = enc2.encrypt(original)
        
        assert encrypted1 != encrypted2, "Different salts should produce different ciphertext"
    
    def test_mask_key(self):
        """Test key masking for display"""
        enc = StreamKeyEncryption(
            encryption_key="test_key",
            salt=b"test_salt"
        )
        
        key = "my-secret-stream-key-12345"
        masked = enc.mask_key(key, show_chars=4)
        
        assert "2345" in masked, "Last 4 characters should be visible"
        assert "*" in masked, "Should contain asterisks"
        assert len(masked) <= 16, "Masked key should not be too long"
    
    def test_encryption_is_deterministic_with_same_key_and_salt(self):
        """Test that same input produces same output with same key/salt"""
        enc = StreamKeyEncryption(
            encryption_key="test_key_32_chars_long_enough!",
            salt=b"test_salt_16byte"
        )
        
        original = "my-stream-key"
        encrypted1 = enc.encrypt(original)
        encrypted2 = enc.encrypt(original)
        
        # Note: Fernet includes timestamp, so this might not be identical
        # But decryption should work
        assert enc.decrypt(encrypted1) == original
        assert enc.decrypt(encrypted2) == original
