from datetime import timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import auth
from app.db.base import Base
from app.middleware import auth_guard
from app.middleware.auth_guard import AuthGuardMiddleware
from app.models.admin_user import AdminUser
from app.models.auth_session import AuthSession
from app.services.auth_security import hash_password
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
    monkeypatch.setattr(auth_guard, "SessionLocal", session_factory)
    monkeypatch.setattr(auth.settings, "auth_enabled", True)
    monkeypatch.setattr(auth.settings, "auth_dev_bypass", False)
    monkeypatch.setattr(auth.settings, "auth_public_docs", False)
    monkeypatch.setattr(auth.settings, "session_secret", "guard-session-secret")
    monkeypatch.setattr(auth.settings, "session_cookie_name", "dotopoly_session")
    monkeypatch.setattr(auth.settings, "session_cookie_secure", False)
    monkeypatch.setattr(auth.settings, "session_idle_timeout_minutes", 720)

    app = FastAPI()
    app.add_middleware(AuthGuardMiddleware)
    app.include_router(auth.router)

    @app.get("/protected")
    def protected_get():
        return {"ok": True}

    @app.post("/protected")
    def protected_post():
        return {"ok": True}

    return TestClient(app)


def create_admin(session_factory, *, active=True):
    db = session_factory()
    admin = AdminUser(
        username="admin@example.com",
        password_hash=hash_password("password"),
        active=active,
    )
    db.add(admin)
    db.commit()
    db.close()


def login(client: TestClient):
    response = client.post(
        "/auth/login",
        json={"username": "admin@example.com", "password": "password"},
    )
    assert response.status_code == 200
    return response


def test_auth_disabled_preserves_current_access(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)
    monkeypatch.setattr(auth.settings, "auth_enabled", False)

    response = client.get("/protected")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_protected_route_requires_session_when_auth_enabled(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)

    response = client.get("/protected")

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"


def test_login_and_session_routes_remain_public(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)

    login_response = login(client)
    session_response = client.get("/auth/session")

    assert login_response.status_code == 200
    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True


def test_valid_session_can_access_protected_get(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    login(client)

    response = client.get("/protected")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_expired_session_is_rejected(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    login(client)
    db = session_factory()
    auth_session = db.query(AuthSession).one()
    auth_session.expires_at = utc_now() - timedelta(minutes=1)
    db.commit()
    db.close()

    response = client.get("/protected")

    assert response.status_code == 401


def test_unsafe_request_requires_csrf_token(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    login(client)

    response = client.post("/protected")

    assert response.status_code == 403
    assert response.json()["detail"] == "CSRF token required"


def test_unsafe_request_accepts_matching_csrf_cookie_and_header(monkeypatch):
    session_factory = make_session_factory()
    create_admin(session_factory)
    client = make_client(monkeypatch, session_factory)
    login(client)
    csrf_token = client.cookies.get(auth.CSRF_COOKIE_NAME)

    response = client.post("/protected", headers={"X-CSRF-Token": csrf_token})

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_options_requests_are_public(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)

    response = client.options("/protected")

    assert response.status_code in {200, 405}
    assert response.status_code != 401
