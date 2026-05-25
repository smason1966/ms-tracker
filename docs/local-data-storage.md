# Local Data Storage

MS Tracker keeps uploaded files outside Docker-managed storage so images, receipts, PDFs, OCR artifacts, and exports do not grow Docker Desktop's VM disk.

## Upload Location

The app now uses a storage abstraction. Configure the backend with:

```bash
STORAGE_BACKEND=local
UPLOADS_DIR=/Users/smason/ms-tracker-data/uploads
```

Local development uses the filesystem. Production can later switch to S3 with:

```bash
STORAGE_BACKEND=s3
S3_BUCKET=your-bucket
S3_REGION=us-west-2
S3_PREFIX=ms-tracker/uploads
```

S3 should be accessed with object APIs and presigned URLs, not mounted as a filesystem. The database attachment records store object keys, not host filesystem paths.

Historical development uploads may exist at:

```bash
/Users/smason/Projects/ms-tracker/backend/uploads
```

That project-repo path is legacy only. New uploads should not be stored there.

Inside the API container, uploads still live at:

```bash
/app/uploads
```

On the host, Docker Compose bind-mounts that path from:

```bash
${MS_TRACKER_UPLOADS_DIR:-./data/uploads}
```

For this machine, the root `.env` sets:

```bash
MS_TRACKER_UPLOADS_DIR=/Users/smason/ms-tracker-data/uploads
```

The API creates these directories on startup:

```bash
/app/uploads/card-images
/app/uploads/receipts
/app/uploads/digital-cards
/app/uploads/ocr-debug
/app/uploads/exports
```

## Migration

Do not delete old Docker volumes until the copied files have been verified in the UI.

1. Stop containers:

```bash
docker compose down
```

2. Create the host upload directory:

```bash
mkdir -p /Users/smason/ms-tracker-data/uploads
```

3. If existing uploads are in the legacy repo path, copy them to the host upload directory:

```bash
rsync -a /Users/smason/Projects/ms-tracker/backend/uploads/ /Users/smason/ms-tracker-data/uploads/
```

4. If existing uploads are inside the API container, copy them out:

```bash
docker compose cp api:/app/uploads/. /Users/smason/ms-tracker-data/uploads/
```

If `docker compose cp` fails, use a temporary container or tar copy from `/app/uploads`.

5. Start with the bind mount:

```bash
docker compose up -d --build
```

6. Verify:

```bash
find /Users/smason/ms-tracker-data/uploads -maxdepth 2 -type f | head
```

Upload a new card image, confirm the file appears under `/Users/smason/ms-tracker-data/uploads`, and confirm the image still displays in the app.

## Backup

Back up the host upload directory together with a Postgres dump. Example:

```bash
tar -czf ms-tracker-uploads-$(date +%Y%m%d).tgz -C /Users/smason/ms-tracker-data uploads
docker compose exec db pg_dump -U mstracker mstracker > ms-tracker-db-$(date +%Y%m%d).sql
```

## Restore

Restore uploads to the configured host directory:

```bash
mkdir -p /Users/smason/ms-tracker-data
tar -xzf ms-tracker-uploads-YYYYMMDD.tgz -C /Users/smason/ms-tracker-data
```

Restore the database separately into the named Postgres volume or database.

## Changing The Upload Directory

Edit the root `.env`:

```bash
MS_TRACKER_UPLOADS_DIR=/path/to/new/uploads
```

Then create the directory, move or copy existing files, and restart Compose:

```bash
mkdir -p /path/to/new/uploads
docker compose up -d
```

## Cleanup

OCR debug images are disabled by default unless `OCR_DEBUG=true`. To purge debug artifacts older than 24 hours and temporary OCR crops:

```bash
npm run cleanup:ocr-debug
```

Optional dry run:

```bash
npm run cleanup:ocr-debug -- --dry-run
```
