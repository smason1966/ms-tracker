from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def load_backend_env() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if os.getenv("DATABASE_URL") or not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if not line or line.strip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "DATABASE_URL":
            os.environ["DATABASE_URL"] = value.strip().strip('"').strip("'")
            return


load_backend_env()

from app.api.retention import purge_failed_ocr_attempt_rows
from app.db.session import SessionLocal
from app.services.ocr_debug import cleanup_ocr_debug_files, purge_temp_ocr_crops


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--older-than-hours", type=int, default=24)
    parser.add_argument("--max-debug-folder-mb", type=int, default=None)
    parser.add_argument("--skip-failed-ocr-attempts", action="store_true")
    parser.add_argument("--reset-failed-cards-to", default="pending")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = {
            "dry_run": args.dry_run,
            "debug_artifacts": {
                "dry_run": True,
                "retention_hours": args.older_than_hours,
                "max_folder_size_mb": args.max_debug_folder_mb,
            }
            if args.dry_run
            else cleanup_ocr_debug_files(
                older_than_hours=args.older_than_hours,
                max_folder_size_mb=args.max_debug_folder_mb,
            ),
            "temporary_ocr_crops": {"dry_run": True}
            if args.dry_run
            else purge_temp_ocr_crops(),
        }
        if args.skip_failed_ocr_attempts:
            result["failed_ocr_attempts"] = {"skipped": True}
        else:
            try:
                result["failed_ocr_attempts"] = purge_failed_ocr_attempt_rows(
                    db,
                    reset_failed_cards_to=args.reset_failed_cards_to,
                    dry_run=args.dry_run,
                )
            except Exception as exc:
                db.rollback()
                result["failed_ocr_attempts"] = {
                    "error": str(exc),
                    "message": "Failed OCR attempt purge skipped because the database was unavailable.",
                }
        if args.dry_run:
            db.rollback()
        else:
            db.commit()
        print(json.dumps(result, sort_keys=True))
    finally:
        db.close()
