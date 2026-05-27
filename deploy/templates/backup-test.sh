#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dotopoly/app}"
ENV_FILE="${ENV_FILE:-/opt/dotopoly/env/test.env}"
BACKUP_DIR="${BACKUP_DIR:-/opt/dotopoly/backups/test}"
UPLOADS_DIR="${UPLOADS_DIR_ON_HOST:-/opt/dotopoly/data/dev/uploads}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.test.yml}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DB_NAME="${POSTGRES_DB:-mstracker_test}"
DB_USER="${POSTGRES_USER:-mstracker}"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$DB_USER" "$DB_NAME" \
  | gzip > "$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"

if [[ -d "$UPLOADS_DIR" ]]; then
  tar -C "$UPLOADS_DIR" -czf "$BACKUP_DIR/uploads-${STAMP}.tar.gz" .
fi

find "$BACKUP_DIR" -type f -name "*.gz" -mtime +30 -delete

echo "Backup complete: $BACKUP_DIR"
