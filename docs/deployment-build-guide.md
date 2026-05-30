# Dotopoly Deployment Build Guide

This guide documents the sanitized staging build pattern used for Dotopoly/MS Tracker. It is meant to make the environment rebuildable without committing live secrets.

Never commit real `.env` files, passwords, `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, htpasswd contents, TLS private keys, database dumps, backups, uploaded card images, receipt images, or OCR artifacts.

## Staging Shape

Staging uses:

- Frontend: `https://test.dotopoly.com`
- Same-origin API: `https://test.dotopoly.com/api`
- Optional direct API host: `https://api-test.dotopoly.com`
- Frontend container bound to `127.0.0.1:3002`
- API container bound to `127.0.0.1:8002`
- Postgres 16 named volume: `dotopoly_test_postgres_data`
- Upload bind mount: `/opt/dotopoly/data/dev/uploads:/app/uploads`

The frontend should be built with:

```sh
NEXT_PUBLIC_API_BASE_URL=https://test.dotopoly.com/api
```

That keeps browser API calls same-origin through Nginx instead of calling the API host directly.

## Files To Install

Copy and edit the staging templates:

```sh
sudo mkdir -p /opt/dotopoly/app /opt/dotopoly/env /opt/dotopoly/data/dev/uploads /opt/dotopoly/backups/test
sudo cp deploy/templates/docker-compose.test.yml /opt/dotopoly/app/docker-compose.test.yml
sudo cp deploy/templates/test.env.example /opt/dotopoly/env/test.env
sudo cp deploy/templates/backup-test.sh /opt/dotopoly/backup-test.sh
sudo cp deploy/templates/nginx-dotopoly-test.conf /etc/nginx/sites-available/dotopoly-test
sudo chmod 600 /opt/dotopoly/env/test.env
sudo chmod 700 /opt/dotopoly/backup-test.sh
```

Edit `/opt/dotopoly/env/test.env` on the VPS. Replace all placeholders with server-local secrets. Do not copy real values back into Git.

Enable Nginx:

```sh
sudo ln -s /etc/nginx/sites-available/dotopoly-test /etc/nginx/sites-enabled/dotopoly-test
sudo nginx -t
sudo systemctl reload nginx
```

## Nginx Outer Gate

Staging keeps Nginx Basic Auth as an outer gate:

```nginx
auth_basic "Dotopoly Test";
auth_basic_user_file /etc/nginx/.htpasswd-dotopoly-test;
```

Create the htpasswd file on the VPS only. Do not commit its contents.

Basic Auth is not the app authentication system. It only protects the staging site from casual public access before the request reaches the app.

## App Auth

App-level auth must also be enabled for staging:

```env
AUTH_ENABLED=true
AUTH_DEV_BYPASS=false
AUTH_PUBLIC_DOCS=false
SESSION_SECRET=replace-with-test-random-secret
SESSION_COOKIE_NAME=dotopoly_session
SESSION_COOKIE_SECURE=true
SESSION_IDLE_TIMEOUT_MINUTES=720
SESSION_ABSOLUTE_TIMEOUT_DAYS=14
```

`SESSION_SECRET` is required when `AUTH_ENABLED=true` in staging or production. Use a strong random value generated on the VPS. Do not reuse it across staging, production, and local development.

Create or rotate the single admin user after the containers and migrations are ready:

```sh
cd /opt/dotopoly/app
docker compose --env-file /opt/dotopoly/env/test.env -f docker-compose.test.yml exec api \
  python scripts/create_admin_user.py --username admin@example.com
```

Enter the password interactively if prompted. Do not put admin passwords in shell history, Git, docs, or logs.

## Build And Start

From `/opt/dotopoly/app`:

```sh
git pull origin staging
docker compose --env-file /opt/dotopoly/env/test.env -f docker-compose.test.yml build api web
docker compose --env-file /opt/dotopoly/env/test.env -f docker-compose.test.yml up -d api web
docker compose --env-file /opt/dotopoly/env/test.env -f docker-compose.test.yml exec api alembic upgrade head
```

The frontend image runs `npm run build` during `docker compose build`. The test/prod web container startup command should only run the already-built app with `npm run start`; do not put `npm run build` in the Compose runtime command. This keeps Nginx from proxying to a container that is still compiling.

For production, use the production env and compose file with the same build-then-start sequence:

```sh
git pull origin staging
docker compose --env-file /opt/dotopoly/env/prod.env -f docker-compose.prod.yml build api web
docker compose --env-file /opt/dotopoly/env/prod.env -f docker-compose.prod.yml up -d api web
docker compose --env-file /opt/dotopoly/env/prod.env -f docker-compose.prod.yml exec api alembic upgrade head
```

Wait for the web healthcheck to become healthy before judging Nginx 502s during deploy:

```sh
docker compose --env-file /opt/dotopoly/env/prod.env -f docker-compose.prod.yml ps web
```

If migrations run during container startup in a future entrypoint, keep one clear migration owner. Do not run competing migration processes at the same time.

## Auth Validation Checks

These checks should be run after deploy. They intentionally use placeholders.

Basic Auth without an app session should not be enough:

```sh
curl -i -u USERNAME:PASSWORD https://test.dotopoly.com/api/gift-cards/
```

Expected app response when `AUTH_ENABLED=true` and no app session cookie is present:

```text
HTTP/2 401
{"detail":"Authentication required"}
```

Login should issue app cookies:

```sh
curl -i -c /tmp/dotopoly-cookies.txt -u USERNAME:PASSWORD \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@example.com","password":"ADMIN_PASSWORD"}' \
  https://test.dotopoly.com/api/auth/login
```

Session check should authenticate with the cookie jar:

```sh
curl -i -b /tmp/dotopoly-cookies.txt -u USERNAME:PASSWORD \
  https://test.dotopoly.com/api/auth/session
```

Authenticated GET requests should work:

```sh
curl -i -b /tmp/dotopoly-cookies.txt -u USERNAME:PASSWORD \
  https://test.dotopoly.com/api/gift-cards/
```

Unsafe requests should require CSRF. A write request without `X-CSRF-Token` should return `403`.

For a CSRF-enabled request, extract the non-HttpOnly `dotopoly_csrf` cookie from the cookie jar and send it as `X-CSRF-Token`. Do not print or paste live session cookies in shared logs.

Logout should revoke the session:

```sh
curl -i -b /tmp/dotopoly-cookies.txt -c /tmp/dotopoly-cookies.txt -u USERNAME:PASSWORD \
  -X POST https://test.dotopoly.com/api/auth/logout
```

Then repeat the protected GET and expect `401`.

## Backups

The staging backup script is installed as:

```sh
/opt/dotopoly/backup-test.sh
```

Recommended permissions:

```sh
sudo chown root:root /opt/dotopoly/backup-test.sh
sudo chmod 700 /opt/dotopoly/backup-test.sh
sudo chmod 700 /opt/dotopoly/backups/test
```

The script backs up:

- Postgres via `pg_dump`, compressed to `/opt/dotopoly/backups/test`
- Uploads from `/opt/dotopoly/data/dev/uploads`

Backups and uploads are sensitive because they can contain encrypted credential blobs, card images, receipt images, OCR artifacts, and operational history. Store and transfer them accordingly.

## Production Warnings

Production should use the production templates, not the staging files:

- `deploy/templates/docker-compose.prod.yml`
- `deploy/templates/nginx-dotopoly-prod.conf`
- `deploy/templates/backup-prod.sh`
- `deploy/templates/prod.env.example`

Production must have separate values for:

- Database password
- `FIELD_ENCRYPTION_KEY`
- `SESSION_SECRET`
- Admin password
- Uploads path
- Backups path

Do not reuse staging or local encryption/session keys in production. Losing `FIELD_ENCRYPTION_KEY` means existing encrypted sensitive fields cannot be decrypted. Exposing it compromises all encrypted data.

Basic Auth can remain as a temporary outer gate, but production should rely on real app authentication and should add MFA/TOTP before broad use with real data.


Both staging and production compose files must define unique project names:
- staging: name: dotopoly-test
- production: name: dotopoly-prod

This prevents docker compose from defaulting to the app directory name and replacing the wrong containers.
