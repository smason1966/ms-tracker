import hmac
import secrets
from hashlib import sha256

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError


_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def password_hash_needs_rehash(password_hash: str) -> bool:
    return _password_hasher.check_needs_rehash(password_hash)


def generate_session_token() -> str:
    return secrets.token_urlsafe(48)


def hash_session_token(token: str, session_secret: str) -> str:
    if not session_secret:
        raise ValueError("SESSION_SECRET is required to hash session tokens")
    return hmac.new(
        session_secret.encode("utf-8"),
        token.encode("utf-8"),
        sha256,
    ).hexdigest()


def verify_session_token_hash(token: str, token_hash: str, session_secret: str) -> bool:
    expected_hash = hash_session_token(token, session_secret)
    return hmac.compare_digest(expected_hash, token_hash)
