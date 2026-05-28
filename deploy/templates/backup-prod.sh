#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/dotopoly/app"
BACKUP_ROOT="/opt/dotopoly/data/backups/prod"
UPLOADS_ROOT="/opt/dotopoly/data/prod"
UPLOADS_DIR="${UPLOADS_ROOT}/uploads"
STAMP="$(date +"%Y-%m-%d_%H-%M-%S")"
BACKUP_DIR="${BACKUP_ROOT}/${STAMP}"

mkdir -p "$BACKUP_DIR"

cd "$APP_DIR"

docker compose \
  --env-file /opt/dotopoly/env/prod.env \
  -f docker-compose.prod.yml \
  exec -T db pg_dump -U mstracker -d mstracker_prod > "$BACKUP_DIR/mstracker_prod.sql"

if [ -d "$UPLOADS_DIR" ]; then
  tar -czf "$BACKUP_DIR/uploads.tar.gz" -C "$UPLOADS_ROOT" uploads
else
  tar -czf "$BACKUP_DIR/uploads.tar.gz" --files-from /dev/null
fi

chmod 700 "$BACKUP_ROOT"
chmod 700 "$BACKUP_DIR"
chmod 600 "$BACKUP_DIR/mstracker_prod.sql" "$BACKUP_DIR/uploads.tar.gz"

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} \;

echo "Production backup complete: $BACKUP_DIR"
