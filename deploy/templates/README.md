# Staging Deployment Templates

These files are sanitized templates for the Dotopoly test/staging VPS. They are not live secrets and should be copied into place, reviewed, and edited on the server.

## Files

- `docker-compose.test.yml`
  - Copy to `/opt/dotopoly/app/docker-compose.test.yml`.
  - Runs the web app on `127.0.0.1:3002`, the API on `127.0.0.1:8002`, Postgres 16 with a named volume, and binds uploads from `/opt/dotopoly/data/dev/uploads` to `/app/uploads`.

- `nginx-dotopoly-test.conf`
  - Copy to `/etc/nginx/sites-available/dotopoly-test`.
  - Symlink into `/etc/nginx/sites-enabled/`.
  - Proxies `https://test.dotopoly.com/` to the frontend and `https://test.dotopoly.com/api/` plus `https://api-test.dotopoly.com/` to the API.
  - References Basic Auth at `/etc/nginx/.htpasswd-dotopoly-test`.

- `backup-test.sh`
  - Copy to `/opt/dotopoly/backup-test.sh`.
  - Make executable with `chmod 700 /opt/dotopoly/backup-test.sh`.
  - Backs up the Postgres database and uploads directory.

- `test.env.example`
  - Copy to `/opt/dotopoly/env/test.env`.
  - Replace every `change-me` / placeholder value with server-local secrets.

- `docker-compose.prod.yml`
  - Copy to `/opt/dotopoly/app/docker-compose.prod.yml`.
  - Runs production web on `127.0.0.1:3001`, API on `127.0.0.1:8001`, Postgres 16 with `dotopoly_prod_postgres_data`, and binds uploads from `/opt/dotopoly/data/prod/uploads` to `/app/uploads`.

- `nginx-dotopoly-prod.conf`
  - Copy to `/etc/nginx/sites-available/dotopoly-prod`.
  - Symlink into `/etc/nginx/sites-enabled/`.
  - Proxies `https://dotopoly.com/` to the frontend and `https://dotopoly.com/api/` plus optional `https://api.dotopoly.com/` to the API.
  - References optional Basic Auth at `/etc/nginx/.htpasswd-dotopoly-prod`.
  - Basic Auth is only a temporary outer gate; long-term production should use real app auth and MFA.

- `backup-prod.sh`
  - Copy to `/opt/dotopoly/backup-prod.sh`.
  - Make executable with `chmod 700 /opt/dotopoly/backup-prod.sh`.
  - Backs up the production Postgres database and uploads directory into `/opt/dotopoly/data/backups/prod`.

- `prod.env.example`
  - Copy to `/opt/dotopoly/env/prod.env`.
  - Replace every `change-me` / placeholder value with production secrets.
  - The production `FIELD_ENCRYPTION_KEY` must be generated separately and must not match staging or local keys.

## Setup Sketch

```sh
sudo mkdir -p /opt/dotopoly/app /opt/dotopoly/env /opt/dotopoly/data/dev/uploads /opt/dotopoly/backups/test
sudo cp deploy/templates/docker-compose.test.yml /opt/dotopoly/app/docker-compose.test.yml
sudo cp deploy/templates/test.env.example /opt/dotopoly/env/test.env
sudo cp deploy/templates/backup-test.sh /opt/dotopoly/backup-test.sh
sudo chmod 600 /opt/dotopoly/env/test.env
sudo chmod 700 /opt/dotopoly/backup-test.sh
sudo cp deploy/templates/nginx-dotopoly-test.conf /etc/nginx/sites-available/dotopoly-test
sudo ln -s /etc/nginx/sites-available/dotopoly-test /etc/nginx/sites-enabled/dotopoly-test
```

Run Compose with the env file so build-time public settings are loaded:

```sh
cd /opt/dotopoly/app
docker compose --env-file /opt/dotopoly/env/test.env -f docker-compose.test.yml up -d --build
```

For production, use the production env file:

```sh
cd /opt/dotopoly/app
docker compose --env-file /opt/dotopoly/env/prod.env -f docker-compose.prod.yml up -d --build
```

Never commit `/opt/dotopoly/env/test.env`, `/opt/dotopoly/env/prod.env`, `.env`, htpasswd files, TLS private keys, database dumps, generated backups, uploaded card images, receipt images, or OCR artifacts. Uploaded images and backups are sensitive production data.
