from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.admin_mfa_challenge import AdminMfaChallenge
from app.models.admin_user import AdminUser
from app.models.auth_session import AuthSession
from app.services.auth_security import (
    generate_session_token,
    hash_session_token,
    verify_password,
)
from app.services.mfa import (
    consume_recovery_code,
    create_recovery_codes,
    encrypt_totp_secret,
    generate_totp_secret,
    totp_uri,
    verify_totp_code,
)
from app.utils.time import utc_now


router = APIRouter(prefix="/auth", tags=["auth"])

CSRF_COOKIE_NAME = "dotopoly_csrf"
MFA_CHALLENGE_COOKIE_NAME = "dotopoly_mfa_challenge"
LOGIN_FAILURE_LIMIT = 5
LOGIN_LOCKOUT_MINUTES = 15
MFA_CHALLENGE_TIMEOUT_MINUTES = 10


class LoginPayload(BaseModel):
    username: str
    password: str


class MfaCodePayload(BaseModel):
    code: str


class MfaChallengePayload(BaseModel):
    code: str | None = None
    recovery_code: str | None = None


def admin_summary(admin: AdminUser) -> dict:
    return {
        "id": admin.id,
        "username": admin.username,
        "active": admin.active,
        "last_login_at": admin.last_login_at,
        "mfa_enabled": admin.mfa_enabled,
    }


def session_secret() -> str:
    if not settings.session_secret:
        raise HTTPException(status_code=500, detail="Session secret is not configured")
    return settings.session_secret


def cookie_max_age_seconds() -> int:
    return max(int(settings.session_idle_timeout_minutes), 1) * 60


def session_expiry():
    return utc_now() + timedelta(seconds=cookie_max_age_seconds())


def mfa_challenge_expiry():
    return utc_now() + timedelta(minutes=MFA_CHALLENGE_TIMEOUT_MINUTES)


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


def set_mfa_challenge_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=MFA_CHALLENGE_COOKIE_NAME,
        value=token,
        max_age=MFA_CHALLENGE_TIMEOUT_MINUTES * 60,
        httponly=True,
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
    clear_mfa_challenge_cookie(response)


def clear_mfa_challenge_cookie(response: Response) -> None:
    response.delete_cookie(
        key=MFA_CHALLENGE_COOKIE_NAME,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
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


def create_auth_session(db: Session, admin: AdminUser, request: Request) -> tuple[str, AuthSession]:
    token = generate_session_token()
    auth_session = AuthSession(
        admin_user_id=admin.id,
        session_token_hash=hash_session_token(token, session_secret()),
        expires_at=session_expiry(),
        user_agent=request.headers.get("user-agent"),
        ip_address=client_ip(request),
    )
    db.add(auth_session)
    db.flush()
    return token, auth_session


def require_current_admin(db: Session, request: Request) -> AdminUser:
    result = find_valid_session(db, request)
    if not result:
        raise HTTPException(status_code=401, detail="Authentication required")
    return result[1]


def create_mfa_challenge(db: Session, admin: AdminUser, request: Request) -> tuple[str, AdminMfaChallenge]:
    token = generate_session_token()
    challenge = AdminMfaChallenge(
        admin_user_id=admin.id,
        challenge_token_hash=hash_session_token(token, session_secret()),
        expires_at=mfa_challenge_expiry(),
        user_agent=request.headers.get("user-agent"),
        ip_address=client_ip(request),
    )
    db.add(challenge)
    db.flush()
    return token, challenge


def find_valid_mfa_challenge(
    db: Session,
    request: Request,
) -> tuple[AdminMfaChallenge, AdminUser] | None:
    token = request.cookies.get(MFA_CHALLENGE_COOKIE_NAME)
    if not token:
        return None

    token_hash = hash_session_token(token, session_secret())
    challenge = (
        db.query(AdminMfaChallenge)
        .filter(AdminMfaChallenge.challenge_token_hash == token_hash)
        .first()
    )
    now = utc_now()
    if not challenge or challenge.used_at is not None or challenge.expires_at <= now:
        return None

    admin = db.query(AdminUser).filter(AdminUser.id == challenge.admin_user_id).first()
    if not admin or not admin.active or not admin.mfa_enabled:
        return None

    return challenge, admin


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

        admin.failed_login_count = 0
        admin.locked_until = None
        admin.updated_at = now

        if admin.mfa_enabled:
            challenge_token, challenge = create_mfa_challenge(db, admin, request)
            db.commit()
            db.refresh(challenge)
            set_mfa_challenge_cookie(response, challenge_token)
            return {
                "authenticated": False,
                "mfa_required": True,
                "challenge_expires_at": challenge.expires_at,
            }

        token, auth_session = create_auth_session(db, admin, request)
        admin.last_login_at = now
        db.commit()
        db.refresh(auth_session)
        db.refresh(admin)

        set_session_cookie(response, token)
        set_csrf_cookie(response)
        return {
            "authenticated": True,
            "mfa_required": False,
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


@router.post("/mfa/setup/start")
def start_mfa_setup(request: Request):
    db: Session = SessionLocal()
    try:
        admin = require_current_admin(db, request)
        secret = generate_totp_secret()
        admin.pending_totp_secret_encrypted = encrypt_totp_secret(secret)
        admin.mfa_updated_at = utc_now()
        db.commit()
        return {
            "issuer": settings.mfa_issuer,
            "username": admin.username,
            "manual_secret": secret,
            "provisioning_uri": totp_uri(secret, admin.username),
        }
    finally:
        db.close()


@router.post("/mfa/setup/verify")
def verify_mfa_setup(payload: MfaCodePayload, request: Request):
    db: Session = SessionLocal()
    try:
        admin = require_current_admin(db, request)
        if not admin.pending_totp_secret_encrypted:
            raise HTTPException(status_code=400, detail="MFA setup has not been started")
        if not verify_totp_code(admin.pending_totp_secret_encrypted, payload.code):
            raise HTTPException(status_code=400, detail="Invalid MFA code")

        now = utc_now()
        admin.totp_secret_encrypted = admin.pending_totp_secret_encrypted
        admin.pending_totp_secret_encrypted = None
        admin.mfa_enabled = True
        admin.mfa_enabled_at = admin.mfa_enabled_at or now
        admin.mfa_updated_at = now
        admin.mfa_last_used_at = now
        recovery_codes = create_recovery_codes(db, admin)
        db.commit()
        return {
            "mfa_enabled": True,
            "recovery_codes": recovery_codes,
        }
    finally:
        db.close()


@router.post("/mfa/recovery-codes/regenerate")
def regenerate_mfa_recovery_codes(payload: MfaCodePayload, request: Request):
    db: Session = SessionLocal()
    try:
        admin = require_current_admin(db, request)
        if not admin.mfa_enabled or not admin.totp_secret_encrypted:
            raise HTTPException(status_code=400, detail="MFA is not enabled")
        if not verify_totp_code(admin.totp_secret_encrypted, payload.code):
            raise HTTPException(status_code=400, detail="Invalid MFA code")

        admin.mfa_last_used_at = utc_now()
        recovery_codes = create_recovery_codes(db, admin)
        db.commit()
        return {
            "mfa_enabled": True,
            "recovery_codes": recovery_codes,
        }
    finally:
        db.close()


@router.post("/mfa/disable")
def disable_mfa(payload: MfaChallengePayload, request: Request):
    db: Session = SessionLocal()
    try:
        admin = require_current_admin(db, request)
        if not admin.mfa_enabled:
            return {"mfa_enabled": False}

        valid_totp = bool(
            payload.code and verify_totp_code(admin.totp_secret_encrypted, payload.code)
        )
        valid_recovery = bool(
            payload.recovery_code and consume_recovery_code(db, admin, payload.recovery_code)
        )
        if not valid_totp and not valid_recovery:
            raise HTTPException(status_code=400, detail="Invalid MFA code")

        now = utc_now()
        admin.mfa_enabled = False
        admin.totp_secret_encrypted = None
        admin.pending_totp_secret_encrypted = None
        admin.mfa_updated_at = now
        (
            db.query(AdminMfaChallenge)
            .filter(AdminMfaChallenge.admin_user_id == admin.id, AdminMfaChallenge.used_at.is_(None))
            .update({"used_at": now}, synchronize_session=False)
        )
        db.commit()
        return {"mfa_enabled": False}
    finally:
        db.close()


@router.post("/mfa/challenge/verify")
def verify_mfa_challenge(payload: MfaChallengePayload, request: Request, response: Response):
    db: Session = SessionLocal()
    try:
        result = find_valid_mfa_challenge(db, request)
        if not result:
            raise HTTPException(status_code=401, detail="MFA challenge is invalid or expired")

        challenge, admin = result
        valid_totp = bool(
            payload.code and verify_totp_code(admin.totp_secret_encrypted, payload.code)
        )
        valid_recovery = bool(
            payload.recovery_code and consume_recovery_code(db, admin, payload.recovery_code)
        )
        if not valid_totp and not valid_recovery:
            raise HTTPException(status_code=400, detail="Invalid MFA code")

        now = utc_now()
        challenge.used_at = now
        admin.last_login_at = now
        admin.mfa_last_used_at = now
        admin.mfa_updated_at = now
        token, auth_session = create_auth_session(db, admin, request)
        db.commit()
        db.refresh(auth_session)
        db.refresh(admin)

        set_session_cookie(response, token)
        set_csrf_cookie(response)
        clear_mfa_challenge_cookie(response)
        return {
            "authenticated": True,
            "mfa_required": False,
            "admin": admin_summary(admin),
            "expires_at": auth_session.expires_at,
        }
    finally:
        db.close()
