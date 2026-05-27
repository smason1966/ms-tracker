# App Authentication Implementation Plan

Dotopoly/MS Tracker stores encrypted gift card, OCR, and fuel credential data. Field encryption protects database contents, but production also needs app-level authentication so the decrypted API surface is not protected only by Nginx Basic Auth.

## First Pass Scope

Build single-admin authentication first. Do not build full multi-user permissions yet.

Goals:

- One admin account can log in, stay logged in across refreshes, and log out.
- Backend API routes require authentication by default.
- Login/session status endpoints are explicit public exceptions.
- Sessions use secure HTTP-only cookies. Do not store access tokens in `localStorage`.
- Staging and production require auth and a strong session secret.
- Local development can opt out only through explicit environment configuration.

## Backend Design

### Dependencies

Add one password hashing dependency:

- Preferred: `argon2-cffi`
- Acceptable alternative: `passlib[bcrypt]`

Argon2id is preferred for new password storage. Store only password hashes, never plaintext passwords.

### Data Model

Add an `admin_users` table:

- `id`
- `email` or `username`, unique
- `password_hash`
- `active`
- `created_at`
- `updated_at`
- `last_login_at`
- `failed_login_count`
- `locked_until`

For single-admin scope, the table can contain one active admin, but using a table keeps the path open for MFA and future multi-user support.

Initial admin creation options:

- Migration creates the table only.
- A separate one-time CLI script creates or rotates the admin password:
  - `backend/scripts/create_admin_user.py`
  - Reads username/password from prompt or environment.
  - Never logs the password.

Do not seed a real password in Alembic or Git.

### Session Storage

Use server-side sessions with an opaque session id in an HTTP-only cookie.

Add `auth_sessions` table:

- `id`
- `session_token_hash`
- `admin_user_id`
- `created_at`
- `last_seen_at`
- `expires_at`
- `revoked_at`
- `user_agent`
- `ip_address`

Cookie:

- Name: `dotopoly_session`
- `HttpOnly`
- `Secure` when `AUTH_COOKIE_SECURE=true`
- `SameSite=Lax` for same-origin `/api` deployment
- Path `/`
- Max age aligned with session timeout

Store only a hash of the random session token in the database.

Recommended timeout:

- Idle timeout: 8-12 hours
- Absolute timeout: 7-14 days
- Refresh `last_seen_at` periodically, not on every request if that becomes noisy.

### Public Endpoints

Public only when `AUTH_ENABLED=true`:

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/session`

`/auth/session` returns:

- `authenticated`
- admin identity summary when authenticated
- expiration metadata if useful

Everything else should require an authenticated session by default.

### Route Protection

Add FastAPI middleware or a global dependency that:

- Checks `AUTH_ENABLED`.
- Allows explicit public paths.
- Validates the session cookie.
- Loads the current admin user.
- Rejects missing, expired, revoked, or inactive sessions with `401`.

Prefer default-deny behavior:

- New API routes should automatically require auth.
- Public routes must be added to a small allowlist.

Keep docs/openapi access configurable:

- In production, consider protecting `/docs`, `/redoc`, and `/openapi.json` behind auth or disabling public docs.

### CSRF

Cookie auth means browser requests automatically include credentials, so CSRF must be considered.

Recommended first pass:

- Same-origin API at `https://dotopoly.com/api`.
- Session cookie `SameSite=Lax`.
- Require a CSRF token for unsafe methods: `POST`, `PUT`, `PATCH`, `DELETE`.

Implementation option:

- On login/session, issue a non-HttpOnly CSRF cookie such as `dotopoly_csrf`.
- Frontend copies it into `X-CSRF-Token` for unsafe API requests.
- Backend verifies header value matches the CSRF token tied to the session.

Do not require CSRF for `GET`, `HEAD`, or `OPTIONS`.

### Login Rate Limiting

Minimum first pass:

- Track failed login attempts on `admin_users`.
- Lock the admin account or source IP briefly after repeated failures.
- Example: 5 failures within 15 minutes locks login for 15 minutes.
- Return generic errors: `Invalid username or password`.

Better follow-up:

- Add IP-based attempt table for distributed brute-force protection.
- Keep Nginx rate limiting on `/api/auth/login`.

### Environment

Add placeholders to env examples during implementation:

- `AUTH_ENABLED=true`
- `AUTH_DEV_BYPASS=false`
- `SESSION_SECRET=replace-with-random-secret`
- `SESSION_COOKIE_NAME=dotopoly_session`
- `SESSION_COOKIE_SECURE=true`
- `SESSION_IDLE_TIMEOUT_MINUTES=720`
- `SESSION_ABSOLUTE_TIMEOUT_DAYS=14`

Rules:

- Staging/production must fail fast if `AUTH_ENABLED=true` and `SESSION_SECRET` is missing.
- Production should not allow `AUTH_DEV_BYPASS=true`.
- Local tests may set `AUTH_ENABLED=false` or use dependency overrides.

`SESSION_SECRET` must not be committed. It should differ across local, staging, and production.

## Frontend Design

Add:

- `/login` page with username/password form.
- App-shell session bootstrap using `GET /api/auth/session`.
- Logout action in the app shell.
- Redirect unauthenticated users to `/login`.
- Redirect authenticated users away from `/login` to the app.

Fetch behavior:

- Use cookie credentials for API requests.
- Add `X-CSRF-Token` for unsafe methods once CSRF is enabled.
- On `401`, clear local session state and route to `/login`.

Do not store session tokens in `localStorage` or `sessionStorage`.

## Testing Plan

Backend tests:

- Password hash is not plaintext and verifies correctly.
- Login succeeds with valid credentials.
- Login fails with invalid credentials and increments failure count.
- Lockout/rate-limit behavior works.
- Session cookie is created with expected flags.
- Authenticated request to protected route succeeds.
- Unauthenticated request to protected route returns `401`.
- Public auth endpoints remain reachable.
- Logout revokes the session.
- Expired/revoked sessions are rejected.
- CSRF token is required for unsafe methods and not required for safe methods.
- `AUTH_ENABLED=false` bypass works only in non-production test/dev config.

Frontend tests/manual checks:

- Unauthenticated app load redirects to `/login`.
- Successful login returns to app.
- Page refresh preserves session.
- Logout returns to login.
- Expired session redirects to login.
- Unsafe API calls include CSRF header.

## Future MFA/TOTP Plan

Extend `admin_users`:

- `totp_secret_encrypted`
- `totp_enabled`
- `totp_confirmed_at`
- `recovery_codes_hash`

Flow:

- Login step 1 verifies password.
- If TOTP is enabled, create a short-lived pending auth challenge, not a full session.
- Login step 2 verifies TOTP and then creates the real session.
- Recovery codes are one-time use and stored hashed.

Use the existing field encryption service for TOTP secrets. Do not store TOTP secrets or recovery codes in plaintext.

## Suggested Commit Split

1. Backend auth models, settings, password hashing, migrations, and admin CLI.
2. Backend session middleware, login/logout/session endpoints, CSRF, tests.
3. Frontend login/logout/session handling.
4. Deployment env examples and Nginx rate-limit guidance.
5. Optional MFA/TOTP follow-up.
