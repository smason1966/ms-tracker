import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken


ENCRYPTED_FIELD_PREFIX = "fernet:v1:"
FIELD_ENCRYPTION_KEY_ENV = "FIELD_ENCRYPTION_KEY"
UNDECRYPTABLE_CREDENTIAL_MESSAGE = "Credential cannot be decrypted in this environment."


class CredentialDecryptionError(RuntimeError):
    """Raised when encrypted credential ciphertext cannot be decrypted."""


def is_encrypted_field_value(value: str | None) -> bool:
    return bool(value and value.startswith(ENCRYPTED_FIELD_PREFIX))


def _configured_environment() -> str:
    for name in ("APP_ENV", "ENVIRONMENT", "DEPLOY_ENV", "MS_TRACKER_ENV"):
        value = os.getenv(name)
        if value:
            return value.strip().lower()
    return ""


def field_encryption_required() -> bool:
    if os.getenv("REQUIRE_FIELD_ENCRYPTION_KEY", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }:
        return True
    return _configured_environment() in {"prod", "production", "staging"}


@lru_cache(maxsize=1)
def _fernet() -> Fernet | None:
    key = os.getenv(FIELD_ENCRYPTION_KEY_ENV, "").strip()
    if not key:
        return None

    try:
        return Fernet(key.encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY must be a valid Fernet key."
        ) from exc


def validate_field_encryption_configuration() -> None:
    if field_encryption_required() and not os.getenv(
        FIELD_ENCRYPTION_KEY_ENV, ""
    ).strip():
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is required in staging/production to protect "
            "gift card and account credentials."
        )

    _fernet()


def encrypt_field(value: str | None) -> str | None:
    if value is None:
        return None

    if is_encrypted_field_value(value):
        return value

    cipher = _fernet()
    if cipher is None:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is required to store sensitive credentials."
        )

    token = cipher.encrypt(value.encode("utf-8")).decode("utf-8")
    return f"{ENCRYPTED_FIELD_PREFIX}{token}"


def decrypt_field(value: str | None) -> str | None:
    if value is None:
        return None

    if not is_encrypted_field_value(value):
        return value

    cipher = _fernet()
    if cipher is None:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is required to read encrypted credentials."
        )

    token = value[len(ENCRYPTED_FIELD_PREFIX) :]
    try:
        return cipher.decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise CredentialDecryptionError(
            "Encrypted credential could not be decrypted."
        ) from exc


def try_decrypt_field(value: str | None) -> tuple[str | None, bool]:
    """Return decrypted value plus an unavailable flag for non-secret summaries."""
    try:
        return decrypt_field(value), False
    except CredentialDecryptionError:
        return None, True
