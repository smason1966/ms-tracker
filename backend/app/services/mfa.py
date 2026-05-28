import secrets
import string

import pyotp
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.admin_mfa_recovery_code import AdminMfaRecoveryCode
from app.models.admin_user import AdminUser
from app.services.auth_security import hash_password, verify_password
from app.services.field_encryption import decrypt_field, encrypt_field
from app.utils.time import utc_now


RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_CHARS = string.ascii_uppercase + string.digits


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def encrypt_totp_secret(secret: str) -> str:
    return encrypt_field(secret) or ""


def decrypt_totp_secret(secret_encrypted: str | None) -> str | None:
    return decrypt_field(secret_encrypted)


def totp_uri(secret: str, username: str, issuer: str | None = None) -> str:
    return pyotp.TOTP(secret).provisioning_uri(
        name=username,
        issuer_name=issuer or settings.mfa_issuer,
    )


def verify_totp_code(
    secret_encrypted: str | None,
    code: str,
    *,
    valid_window: int = 1,
) -> bool:
    secret = decrypt_totp_secret(secret_encrypted)
    cleaned_code = "".join(ch for ch in (code or "") if ch.isdigit())
    if not secret or not cleaned_code:
        return False

    return bool(pyotp.TOTP(secret).verify(cleaned_code, valid_window=valid_window))


def generate_recovery_code() -> str:
    alphabet = RECOVERY_CODE_CHARS
    first = "".join(secrets.choice(alphabet) for _ in range(4))
    second = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"{first}-{second}"


def normalize_recovery_code(code: str) -> str:
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def hash_recovery_code(code: str) -> str:
    normalized = normalize_recovery_code(code)
    if not normalized:
        raise ValueError("Recovery code is required")
    return hash_password(normalized)


def verify_recovery_code(code: str, code_hash: str) -> bool:
    normalized = normalize_recovery_code(code)
    if not normalized:
        return False
    return verify_password(normalized, code_hash)


def create_recovery_codes(
    db: Session,
    admin: AdminUser,
    *,
    count: int = RECOVERY_CODE_COUNT,
) -> list[str]:
    now = utc_now()
    (
        db.query(AdminMfaRecoveryCode)
        .filter(
            AdminMfaRecoveryCode.admin_user_id == admin.id,
            AdminMfaRecoveryCode.used_at.is_(None),
            AdminMfaRecoveryCode.revoked_at.is_(None),
        )
        .update({"revoked_at": now}, synchronize_session=False)
    )

    plaintext_codes = [generate_recovery_code() for _ in range(count)]
    db.add_all(
        [
            AdminMfaRecoveryCode(
                admin_user_id=admin.id,
                code_hash=hash_recovery_code(code),
                created_at=now,
            )
            for code in plaintext_codes
        ]
    )
    admin.mfa_updated_at = now
    return plaintext_codes


def consume_recovery_code(db: Session, admin: AdminUser, code: str) -> bool:
    recovery_codes = (
        db.query(AdminMfaRecoveryCode)
        .filter(
            AdminMfaRecoveryCode.admin_user_id == admin.id,
            AdminMfaRecoveryCode.used_at.is_(None),
            AdminMfaRecoveryCode.revoked_at.is_(None),
        )
        .all()
    )

    for recovery_code in recovery_codes:
        if verify_recovery_code(code, recovery_code.code_hash):
            now = utc_now()
            recovery_code.used_at = now
            admin.mfa_last_used_at = now
            admin.mfa_updated_at = now
            return True

    return False
