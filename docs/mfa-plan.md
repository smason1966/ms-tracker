# MFA/TOTP Implementation Plan

Dotopoly should add MFA before production use with real card data. First pass: single-admin TOTP with recovery codes, built on the existing HTTP-only session auth.

## Goals

- Support standard TOTP authenticator apps.
- Require MFA after password login when MFA is enabled for the admin.
- Allow production to require MFA with `MFA_REQUIRED=true`.
- Keep local/staging flexible with `MFA_REQUIRED=false` while testing.
- Store TOTP secrets encrypted at rest.
- Store recovery backup codes hashed, never plaintext after generation.

## Data Model

Add fields/tables with a migration:

- `admin_users.mfa_enabled` boolean, default false.
- `admin_users.totp_secret_encrypted` text nullable.
- `admin_users.totp_confirmed_at` datetime nullable.
- `admin_users.mfa_recovery_codes_rotated_at` datetime nullable.
- `admin_mfa_recovery_codes`
  - `id`
  - `admin_user_id`
  - `code_hash`
  - `used_at`
  - `created_at`

Encrypt `totp_secret_encrypted` with the existing field encryption system and `fernet:v1:` prefix behavior. Recovery codes should use a password/token hash style, not reversible encryption.

## Environment

Add placeholders:

```env
MFA_REQUIRED=false
```

Production target:

```env
MFA_REQUIRED=true
```

Startup validation should fail in production when `AUTH_ENABLED=true`, `MFA_REQUIRED=true`, and no admin user has confirmed MFA, unless an explicit break-glass setup mode is documented.

## Login Flow

1. `POST /auth/login` verifies username/password.
2. If password is valid and MFA is not required for the user, create the normal session.
3. If MFA is required/enabled, create a short-lived pending MFA challenge instead of a full session.
4. Frontend routes to MFA challenge screen.
5. `POST /auth/mfa/challenge/verify` verifies TOTP or recovery code.
6. On success, revoke/consume the pending challenge and create the normal auth session cookie.

Pending challenges should be short-lived, stored server-side, and identified by an HTTP-only temporary cookie or opaque challenge id. Do not store challenge secrets in localStorage.

## API Endpoint Plan

- `POST /auth/mfa/setup/start`
  - Requires an authenticated admin session.
  - Generates a new TOTP secret.
  - Stores it as pending encrypted secret or returns it only as a setup challenge record.
  - Returns `otpauth://` URI and manual secret for QR setup.

- `POST /auth/mfa/setup/verify`
  - Requires authenticated admin session.
  - Verifies a current TOTP code for the pending secret.
  - Enables MFA.
  - Generates recovery backup codes once and returns plaintext codes only in this response.
  - Stores recovery code hashes.

- `POST /auth/mfa/challenge/verify`
  - Public after password login challenge.
  - Accepts TOTP code or recovery code.
  - On TOTP success, creates a normal auth session.
  - On recovery code success, marks that code used and creates a normal auth session.

- `POST /auth/mfa/disable`
  - Requires authenticated admin session and current password plus TOTP/recovery confirmation.
  - Disables MFA and clears TOTP secret/recovery codes.

- `POST /auth/mfa/rotate`
  - Requires authenticated admin session and TOTP/recovery confirmation.
  - Starts replacement setup flow for a new authenticator.

- `POST /auth/mfa/recovery-codes/regenerate`
  - Requires authenticated admin session and TOTP confirmation.
  - Invalidates unused old recovery codes.
  - Returns new plaintext codes once.

## Frontend Flow

- Settings/Auth section:
  - Show MFA status.
  - Start setup.
  - Display QR code and manual secret.
  - Confirm setup with six-digit TOTP.
  - Show recovery codes once with strong save warning.
  - Disable/rotate/regenerate actions with confirmation.

- Login:
  - Password submit may return `mfa_required=true`.
  - Show MFA challenge screen.
  - Accept authenticator code.
  - Offer recovery code option.
  - Do not store tokens or MFA state in localStorage.

## Security Details

- Use a well-maintained TOTP library, such as `pyotp`.
- Use issuer name `Dotopoly`.
- Use admin username as account label.
- Allow a small clock skew window only if necessary.
- Rate-limit password login and MFA challenge attempts.
- Never log TOTP secrets, recovery codes, submitted MFA codes, session tokens, or CSRF tokens.
- Recovery codes should be shown once, formatted for readability, and hashed before storage.
- Disabling or rotating MFA should require re-authentication.

## Tests

Backend:

- Setup start requires authenticated session.
- Setup verify rejects invalid TOTP.
- Setup verify enables MFA with valid TOTP.
- TOTP secret is not plaintext in DB.
- Recovery codes are not plaintext in DB.
- Login with MFA-enabled admin returns pending challenge, not full session.
- Challenge verify with valid TOTP creates session.
- Challenge verify with invalid TOTP fails.
- Recovery code works once and is marked used.
- Used recovery code cannot be reused.
- `MFA_REQUIRED=true` blocks login/session creation when admin has no configured MFA.

Frontend:

- Login redirects to MFA challenge when required.
- Challenge success routes into app.
- Invalid code shows clear error.
- Setup QR/manual secret flow renders.
- Recovery codes are displayed once after setup/regeneration.

## Rollout

1. Implement and test on a local throwaway database.
2. Deploy to staging with `MFA_REQUIRED=false`.
3. Create/verify MFA for the staging admin.
4. Test password plus TOTP login, logout, session refresh, recovery code, disable, and regenerate.
5. Turn on `MFA_REQUIRED=true` in staging and validate no app route is reachable without MFA.
6. Deploy to production with `MFA_REQUIRED=false`.
7. Configure production admin MFA immediately.
8. Store recovery codes securely outside the app.
9. Turn on `MFA_REQUIRED=true` for production before entering real card data.

## Non-Goals For First Pass

- Full multi-user MFA management.
- WebAuthn/passkeys.
- Remember-this-device.
- SMS or email OTP.
- MFA bypass flows beyond documented recovery codes and controlled admin rotation.
