import hmac

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.api.auth import CSRF_COOKIE_NAME, find_valid_session
from app.core.config import settings
from app.db.session import SessionLocal


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
PUBLIC_AUTH_ROUTES = {
    ("POST", "/auth/login"),
    ("POST", "/auth/logout"),
    ("GET", "/auth/session"),
    ("POST", "/auth/mfa/challenge/verify"),
}
PUBLIC_DOC_ROUTES = {"/docs", "/redoc", "/openapi.json"}


def is_public_route(request: Request) -> bool:
    path = request.url.path
    method = request.method.upper()
    if method == "OPTIONS":
        return True
    if (method, path) in PUBLIC_AUTH_ROUTES:
        return True
    if settings.auth_public_docs and path in PUBLIC_DOC_ROUTES:
        return True
    return False


def csrf_is_valid(request: Request) -> bool:
    header_token = request.headers.get("x-csrf-token")
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    if not header_token or not cookie_token:
        return False
    return hmac.compare_digest(header_token, cookie_token)


class AuthGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if (
            not settings.auth_enabled
            or settings.auth_dev_bypass
            or is_public_route(request)
        ):
            return await call_next(request)

        db = SessionLocal()
        try:
            session_result = find_valid_session(db, request)
        finally:
            db.close()

        if not session_result:
            return JSONResponse(
                {"detail": "Authentication required"},
                status_code=401,
            )

        if request.method.upper() in UNSAFE_METHODS and not csrf_is_valid(request):
            return JSONResponse(
                {"detail": "CSRF token required"},
                status_code=403,
            )

        return await call_next(request)
