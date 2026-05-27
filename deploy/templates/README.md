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

Never commit `/opt/dotopoly/env/test.env`, `.env`, htpasswd files, TLS private keys, database dumps, or generated backups.
