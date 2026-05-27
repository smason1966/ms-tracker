from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.admin_user import AdminUser
from app.models.auth_session import AuthSession
from app.services.auth_security import (
    generate_session_token,
    hash_session_token,
    verify_password,
)
from app.utils.time import utc_now


router = APIRouter(prefix="/auth", tags=["auth"])

CSRF_COOKIE_NAME = "dotopoly_csrf"
LOGIN_FAILURE_LIMIT = 5
LOGIN_LOCKOUT_MINUTES = 15


class LoginPayload(BaseModel):
    username: str
    password: str


def admin_summary(admin: AdminUser) -> dict:
    return {
        "id": admin.id,
        "username": admin.username,
        "active": admin.active,
        "last_login_at": admin.last_login_at,
    }


def session_secret() -> str:
    if not settings.session_secret:
        raise HTTPException(status_code=500, detail="Session secret is not configured")
    return settings.session_secret


def cookie_max_age_seconds() -> int:
    return max(int(settings.session_idle_timeout_minutes), 1) * 60


def session_expiry():
    return utc_now() + timedelta(seconds=cookie_max_age_seconds())


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=cookie_max_age_seconds(),
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


def set_csrf_cookie(response: Response, token: str | None = None) -> None:
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=token or generate_session_token(),
        max_age=cookie_max_age_seconds(),
        httponly=False,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.delete_cookie(
        key=CSRF_COOKIE_NAME,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=False,
        samesite="lax",
    )


def find_valid_session(
    db: Session,
    request: Request,
) -> tuple[AuthSession, AdminUser] | None:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None

    token_hash = hash_session_token(token, session_secret())
    auth_session = (
        db.query(AuthSession)
        .filter(AuthSession.session_token_hash == token_hash)
        .first()
    )
    if not auth_session:
        return None

    now = utc_now()
    if auth_session.revoked_at is not None or auth_session.expires_at <= now:
        return None

    admin = db.query(AdminUser).filter(AdminUser.id == auth_session.admin_user_id).first()
    if not admin or not admin.active:
        return None

    auth_session.last_seen_at = now
    auth_session.expires_at = session_expiry()
    db.commit()
    db.refresh(auth_session)
    return auth_session, admin


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.post("/login")
def login(payload: LoginPayload, request: Request, response: Response):
    db: Session = SessionLocal()
    try:
        username = payload.username.strip().lower()
        admin = db.query(AdminUser).filter(AdminUser.username == username).first()
        now = utc_now()

        if not admin:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        if not admin.active:
            raise HTTPException(status_code=403, detail="Admin user is inactive")
        if admin.locked_until is not None and admin.locked_until > now:
            raise HTTPException(status_code=423, detail="Admin user is temporarily locked")

        if not verify_password(payload.password, admin.password_hash):
            admin.failed_login_count = int(admin.failed_login_count or 0) + 1
            if admin.failed_login_count >= LOGIN_FAILURE_LIMIT:
                admin.locked_until = now + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
            admin.updated_at = now
            db.commit()
            raise HTTPException(status_code=401, detail="Invalid username or password")

        token = generate_session_token()
        auth_session = AuthSession(
            admin_user_id=admin.id,
            session_token_hash=hash_session_token(token, session_secret()),
            expires_at=session_expiry(),
            user_agent=request.headers.get("user-agent"),
            ip_address=client_ip(request),
        )
        admin.failed_login_count = 0
        admin.locked_until = None
        admin.last_login_at = now
        admin.updated_at = now
        db.add(auth_session)
        db.commit()
        db.refresh(auth_session)
        db.refresh(admin)

        set_session_cookie(response, token)
        set_csrf_cookie(response)
        return {
            "authenticated": True,
            "admin": admin_summary(admin),
            "expires_at": auth_session.expires_at,
        }
    finally:
        db.close()


@router.post("/logout")
def logout(request: Request, response: Response):
    db: Session = SessionLocal()
    try:
        token = request.cookies.get(settings.session_cookie_name)
        if token:
            token_hash = hash_session_token(token, session_secret())
            auth_session = (
                db.query(AuthSession)
                .filter(AuthSession.session_token_hash == token_hash)
                .first()
            )
            if auth_session and auth_session.revoked_at is None:
                auth_session.revoked_at = utc_now()
                db.commit()
        clear_auth_cookies(response)
        return {"authenticated": False}
    finally:
        db.close()


@router.get("/session")
def session(request: Request, response: Response):
    db: Session = SessionLocal()
    try:
        result = find_valid_session(db, request)
        if not result:
            return {"authenticated": False, "admin": None}

        auth_session, admin = result
        set_csrf_cookie(response, request.cookies.get(CSRF_COOKIE_NAME))
        return {
            "authenticated": True,
            "admin": admin_summary(admin),
            "expires_at": auth_session.expires_at,
        }
    finally:
        db.close()
