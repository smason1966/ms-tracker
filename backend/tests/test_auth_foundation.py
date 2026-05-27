from datetime import timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

from app.core.config import Settings
from app.db.base import Base
from app.models.admin_user import AdminUser
from app.models.auth_session import AuthSession
from app.services.auth_security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    verify_password,
    verify_session_token_hash,
)
from app.utils.time import utc_now
from scripts.create_admin_user import create_or_update_admin_user


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_password_hash_is_not_plaintext_and_verifies():
    password = "correct horse battery staple"

    password_hash = hash_password(password)

    assert password not in password_hash
    assert password_hash != password
    assert verify_password(password, password_hash)


def test_invalid_password_fails_verification():
    password_hash = hash_password("real password")

    assert not verify_password("wrong password", password_hash)


def test_session_token_hash_verifies_without_storing_plaintext():
    secret = "test-session-secret"
    token = generate_session_token()

    token_hash = hash_session_token(token, secret)

    assert token not in token_hash
    assert token_hash != token
    assert verify_session_token_hash(token, token_hash, secret)
    assert not verify_session_token_hash("wrong-token", token_hash, secret)


def test_auth_session_can_store_hashed_token_only():
    db = make_session()
    admin = AdminUser(
        username="admin@example.com",
        password_hash=hash_password("password"),
    )
    token = generate_session_token()
    session = AuthSession(
        admin_user_id=1,
        session_token_hash=hash_session_token(token, "session-secret"),
        expires_at=utc_now() + timedelta(hours=1),
    )

    db.add(admin)
    db.flush()
    session.admin_user_id = admin.id
    db.add(session)
    db.commit()

    stored_session = db.query(AuthSession).one()
    assert stored_session.session_token_hash != token
    assert verify_session_token_hash(
        token,
        stored_session.session_token_hash,
        "session-secret",
    )


def test_create_admin_user_creates_and_rotates_without_printing_password(capsys):
    db = make_session()

    admin = create_or_update_admin_user(
        db,
        username="Admin@Example.com",
        password="initial-password",
    )
    captured = capsys.readouterr()

    assert captured.out == ""
    assert captured.err == ""
    assert admin.username == "admin@example.com"
    assert "initial-password" not in admin.password_hash
    assert verify_password("initial-password", admin.password_hash)

    rotated = create_or_update_admin_user(
        db,
        username="admin@example.com",
        password="rotated-password",
    )
    captured = capsys.readouterr()

    assert rotated.id == admin.id
    assert captured.out == ""
    assert captured.err == ""
    assert verify_password("rotated-password", rotated.password_hash)
    assert not verify_password("initial-password", rotated.password_hash)


def test_session_secret_required_when_auth_enabled_in_staging():
    with pytest.raises(ValueError, match="SESSION_SECRET is required"):
        Settings(
            database_url="sqlite://",
            app_env="staging",
            auth_enabled=True,
            session_secret=None,
        )


def test_session_secret_not_required_when_auth_disabled_locally():
    settings = Settings(
        database_url="sqlite://",
        app_env="local",
        auth_enabled=False,
        session_secret=None,
    )

    assert settings.auth_enabled is False
