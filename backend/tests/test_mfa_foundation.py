from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.admin_mfa_recovery_code import AdminMfaRecoveryCode
from app.models.admin_user import AdminUser
from app.services.field_encryption import ENCRYPTED_FIELD_PREFIX, _fernet
from app.services.mfa import (
    consume_recovery_code,
    create_recovery_codes,
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_recovery_code,
    generate_totp_secret,
    hash_recovery_code,
    verify_recovery_code,
    verify_totp_code,
)


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_totp_secret_generation():
    secret = generate_totp_secret()

    assert len(secret) >= 16
    assert secret.isalnum()


def test_valid_totp_verifies(monkeypatch):
    import pyotp

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _fernet.cache_clear()
    secret = generate_totp_secret()
    encrypted_secret = encrypt_totp_secret(secret)
    code = pyotp.TOTP(secret).now()

    assert verify_totp_code(encrypted_secret, code)

    _fernet.cache_clear()


def test_invalid_totp_is_rejected(monkeypatch):
    import pyotp

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _fernet.cache_clear()
    secret = generate_totp_secret()
    encrypted_secret = encrypt_totp_secret(secret)
    valid_code = pyotp.TOTP(secret).now()
    invalid_code = f"{(int(valid_code) + 1) % 1_000_000:06d}"

    assert not verify_totp_code(encrypted_secret, invalid_code)

    _fernet.cache_clear()


def test_encrypted_totp_secret_round_trip(monkeypatch):
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _fernet.cache_clear()
    secret = generate_totp_secret()

    encrypted_secret = encrypt_totp_secret(secret)

    assert encrypted_secret != secret
    assert encrypted_secret.startswith(ENCRYPTED_FIELD_PREFIX)
    assert decrypt_totp_secret(encrypted_secret) == secret

    _fernet.cache_clear()


def test_recovery_code_hash_verifies_without_plaintext():
    code = generate_recovery_code()

    code_hash = hash_recovery_code(code)

    assert code not in code_hash
    assert verify_recovery_code(code, code_hash)
    assert verify_recovery_code(code.replace("-", "").lower(), code_hash)
    assert not verify_recovery_code("WRONG-CODE", code_hash)


def test_used_recovery_code_cannot_be_reused():
    db = make_session()
    admin = AdminUser(
        username="admin@example.com",
        password_hash="not-used-in-this-test",
    )
    db.add(admin)
    db.flush()
    codes = create_recovery_codes(db, admin, count=1)
    db.commit()

    assert consume_recovery_code(db, admin, codes[0])
    db.commit()
    assert not consume_recovery_code(db, admin, codes[0])

    stored_code = db.query(AdminMfaRecoveryCode).one()
    assert stored_code.used_at is not None
    assert codes[0] not in stored_code.code_hash
    db.close()
