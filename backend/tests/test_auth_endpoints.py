from datetime import timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import auth
from app.db.base import Base
from app.models.admin_user import AdminUser
from app.models.auth_session import AuthSession
from app.services.auth_security import hash_password, verify_session_token_hash
from app.utils.time import utc_now


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
    monkeypatch.setattr(auth.settings, "session_secret", "endpoint-session-secret")
    monkeypatch.setattr(auth.settings, "session_cookie_name", "dotopoly_session")
    monkeypatch.setattr(auth.settings, "session_cookie_secure", False)
    monkeypatch.setattr(auth.settings, "session_idle_timeout_minutes", 720)
    app = FastAPI()
    app.include_router(auth.router)
    return TestClient(app)


def create_admin(session_factory, *, username="admin@example.com", password="password"):
    db = session_factory()
    admin = AdminUser(
        username=username,
        password_hash=hash_password(password),
        active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    db.close()
    return admin


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
