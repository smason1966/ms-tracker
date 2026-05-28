from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import auth
from app.db.base import Base
from app.models.admin_mfa_challenge import AdminMfaChallenge
from app.models.admin_mfa_recovery_code import AdminMfaRecoveryCode
from app.models.admin_user import AdminUser
from app.models.auth_session import AuthSession
from app.services.auth_security import hash_password, verify_session_token_hash
from app.services.field_encryption import ENCRYPTED_FIELD_PREFIX, _fernet
from app.services.mfa import encrypt_totp_secret, generate_totp_secret
from app.utils.time import utc_now


TEST_FIELD_ENCRYPTION_KEY = Fernet.generate_key().decode()


def make_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def make_client(monkeypatch, session_factory):
    monkeypatch.setattr(auth, "SessionLocal", session_factory)
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", TEST_FIELD_ENCRYPTION_KEY)
    _fernet.cache_clear()
    monkeypatch.setattr(auth.settings, "session_secret", "endpoint-session-secret")
    monkeypatch.setattr(auth.settings, "session_cookie_name", "dotopoly_session")
    monkeypatch.setattr(auth.settings, "session_cookie_secure", False)
    monkeypatch.setattr(auth.settings, "session_idle_timeout_minutes", 720)
    app = FastAPI()
    app.include_router(auth.router)
    return TestClient(app)


def create_admin(
    session_factory,
    *,
    username="admin@example.com",
    password="password",
    role="admin",
):
    db = session_factory()
    admin = AdminUser(
        username=username,
        password_hash=hash_password(password),
        role=role,
        active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    db.close()
    return admin


def create_mfa_admin(session_factory, *, username="admin@example.com", password="password"):
    secret = generate_totp_secret()
    db = session_factory()
    admin = AdminUser(
        username=username,
        password_hash=hash_password(password),
        active=True,
        mfa_enabled=True,
        totp_secret_encrypted=encrypt_totp_secret(secret),
        mfa_enabled_at=utc_now(),
    )
    db.add(admin)
    db.commit()
    db.close()
    return secret


def test_login_creates_session_and_sets_http_only_cookie(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)

    response = client.post(
        "/auth/login",
        json={"username": "Admin@Example.com", "password": "password"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is True
    assert body["admin"]["username"] == "admin@example.com"
    assert "httponly" in response.headers["set-cookie"].lower()
    assert "dotopoly_session=" in response.headers["set-cookie"]
    assert "dotopoly_csrf=" in response.headers["set-cookie"]

    session_token = client.cookies.get("dotopoly_session")
    assert session_token
    db = session_factory()
    auth_session = db.query(AuthSession).one()
    admin = db.query(AdminUser).one()
    assert auth_session.session_token_hash != session_token
    assert verify_session_token_hash(
        session_token,
        auth_session.session_token_hash,
        "endpoint-session-secret",
    )
    assert admin.failed_login_count == 0
    assert admin.last_login_at is not None
    db.close()


def test_session_endpoint_returns_admin_for_valid_session(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )

    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    assert response.json()["admin"]["username"] == "admin@example.com"
    assert response.json()["admin"]["role"] == "admin"


def test_session_endpoint_returns_false_without_valid_session(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)

    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "admin": None}


def test_logout_revokes_session_and_clears_cookie(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )

    response = client.post("/auth/logout")

    assert response.status_code == 200
    assert response.json() == {"authenticated": False}
    db = session_factory()
    auth_session = db.query(AuthSession).one()
    assert auth_session.revoked_at is not None
    db.close()
    assert client.get("/auth/session").json()["authenticated"] is False


def test_failed_login_increments_count_and_locks(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)

    for _ in range(auth.LOGIN_FAILURE_LIMIT):
        response = client.post(
            "/auth/login",
            json={"username": "admin@example.com", "password": "wrong"},
        )
        assert response.status_code == 401

    db = session_factory()
    admin = db.query(AdminUser).one()
    assert admin.failed_login_count == auth.LOGIN_FAILURE_LIMIT
    assert admin.locked_until is not None
    db.close()

    locked_response = client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )
    assert locked_response.status_code == 423


def test_login_rejects_inactive_user(monkeypatch):
    session_factory = make_session_factory()
    admin = create_admin(session_factory)
    db = session_factory()
    stored = db.query(AdminUser).filter(AdminUser.id == admin.id).one()
    stored.active = False
    db.commit()
    db.close()
    client = make_client(monkeypatch, session_factory)

    response = client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )

    assert response.status_code == 403


def test_expired_session_returns_unauthenticated(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )
    db = session_factory()
    auth_session = db.query(AuthSession).one()
    auth_session.expires_at = utc_now() - timedelta(minutes=1)
    db.commit()
    db.close()

    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["authenticated"] is False


def test_mfa_setup_start_returns_provisioning_details(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )

    response = client.post("/auth/mfa/setup/start")

    assert response.status_code == 200
    body = response.json()
    assert body["issuer"] == "Dotopoly"
    assert body["username"] == "admin@example.com"
    assert body["manual_secret"]
    assert body["manual_secret"] in body["provisioning_uri"]
    db = session_factory()
    admin = db.query(AdminUser).one()
    assert admin.pending_totp_secret_encrypted.startswith(ENCRYPTED_FIELD_PREFIX)
    assert body["manual_secret"] not in admin.pending_totp_secret_encrypted
    db.close()


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/auth/mfa/setup/start", None),
        ("/auth/mfa/setup/verify", {"code": "123456"}),
        ("/auth/mfa/recovery-codes/regenerate", {"code": "123456"}),
        ("/auth/mfa/disable", {"code": "123456"}),
    ],
)
def test_tester_user_cannot_manage_mfa(monkeypatch, path, payload):
    session_factory = make_session_factory()
    create_admin(session_factory, role="tester")
    client = make_client(monkeypatch, session_factory)
    login_response = client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )

    response = client.post(path, json=payload) if payload is not None else client.post(path)

    assert login_response.status_code == 200
    assert login_response.json()["admin"]["role"] == "tester"
    assert response.status_code == 403
    assert response.json()["detail"] == "Admin role required"


def test_mfa_setup_verify_enables_mfa_and_returns_recovery_codes(monkeypatch):
    import pyotp

    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )
    setup = client.post("/auth/mfa/setup/start").json()
    code = pyotp.TOTP(setup["manual_secret"]).now()

    response = client.post("/auth/mfa/setup/verify", json={"code": code})

    assert response.status_code == 200
    body = response.json()
    assert body["mfa_enabled"] is True
    assert len(body["recovery_codes"]) == 10
    db = session_factory()
    admin = db.query(AdminUser).one()
    recovery_codes = db.query(AdminMfaRecoveryCode).all()
    assert admin.mfa_enabled is True
    assert admin.pending_totp_secret_encrypted is None
    assert admin.totp_secret_encrypted.startswith(ENCRYPTED_FIELD_PREFIX)
    assert len(recovery_codes) == 10
    assert all(body["recovery_codes"][0] not in code_row.code_hash for code_row in recovery_codes)
    db.close()


def test_invalid_mfa_setup_code_does_not_enable_mfa(monkeypatch):
    import pyotp

    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )
    setup = client.post("/auth/mfa/setup/start").json()
    valid_code = pyotp.TOTP(setup["manual_secret"]).now()
    invalid_code = f"{(int(valid_code) + 1) % 1_000_000:06d}"

    response = client.post("/auth/mfa/setup/verify", json={"code": invalid_code})

    assert response.status_code == 400
    db = session_factory()
    admin = db.query(AdminUser).one()
    assert admin.mfa_enabled is False
    assert admin.totp_secret_encrypted is None
    assert admin.pending_totp_secret_encrypted is not None
    db.close()


def test_login_with_mfa_enabled_requires_challenge_without_full_session(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)
    create_mfa_admin(session_factory)

    response = client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is False
    assert body["mfa_required"] is True
    assert client.cookies.get(auth.MFA_CHALLENGE_COOKIE_NAME)
    assert not client.cookies.get("dotopoly_session")
    db = session_factory()
    assert db.query(AuthSession).count() == 0
    assert db.query(AdminMfaChallenge).count() == 1
    db.close()


def test_valid_mfa_challenge_creates_session(monkeypatch):
    import pyotp

    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)
    secret = create_mfa_admin(session_factory)
    client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )

    response = client.post(
        "/auth/mfa/challenge/verify",
        json={"code": pyotp.TOTP(secret).now()},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is True
    assert body["mfa_required"] is False
    assert client.cookies.get("dotopoly_session")
    db = session_factory()
    assert db.query(AuthSession).count() == 1
    assert db.query(AdminMfaChallenge).one().used_at is not None
    assert db.query(AdminUser).one().mfa_last_used_at is not None
    db.close()


def test_recovery_code_challenge_works_once(monkeypatch):
    import pyotp

    session_factory = make_session_factory()
    create_admin(session_factory)
    setup_client = make_client(monkeypatch, session_factory)
    setup_client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )
    setup = setup_client.post("/auth/mfa/setup/start").json()
    recovery_codes = setup_client.post(
        "/auth/mfa/setup/verify",
        json={"code": pyotp.TOTP(setup["manual_secret"]).now()},
    ).json()["recovery_codes"]

    login_client = make_client(monkeypatch, session_factory)
    login_client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )
    first_response = login_client.post(
        "/auth/mfa/challenge/verify",
        json={"recovery_code": recovery_codes[0]},
    )

    second_client = make_client(monkeypatch, session_factory)
    second_client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )
    second_response = second_client.post(
        "/auth/mfa/challenge/verify",
        json={"recovery_code": recovery_codes[0]},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 400
    db = session_factory()
    assert db.query(AdminMfaRecoveryCode).filter(AdminMfaRecoveryCode.used_at.is_not(None)).count() == 1
    db.close()


def test_mfa_disabled_user_logs_in_normally(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)

    response = client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )

    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    assert response.json()["mfa_required"] is False
    assert client.cookies.get("dotopoly_session")
