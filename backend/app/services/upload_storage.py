from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timedelta
from app.utils.time import utc_now
from pathlib import Path
from urllib.parse import urlparse

from app.services.storage import LocalStorageBackend, object_key_for, storage

logger = logging.getLogger(__name__)

PUBLIC_UPLOAD_ROOT = "uploads"


def default_upload_root() -> Path:
    local_path = storage.local_path("")
    if local_path is not None:
        return local_path
    return Path("/app/uploads")


UPLOAD_ROOT = default_upload_root()
UPLOAD_SUBDIRECTORIES = [
    "card-images",
    "receipts",
    "digital-cards",
    "ocr-debug",
    "exports",
    "fuel-account-barcodes",
]


def ensure_upload_directories(upload_root: Path = UPLOAD_ROOT) -> None:
    upload_root.mkdir(parents=True, exist_ok=True)
    for subdirectory in UPLOAD_SUBDIRECTORIES:
        (upload_root / subdirectory).mkdir(parents=True, exist_ok=True)


def upload_dir(subdirectory: str, upload_root: Path = UPLOAD_ROOT) -> Path:
    path = storage.local_path(subdirectory.strip("/")) or (upload_root / subdirectory.strip("/"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def public_upload_reference(*parts: str) -> str:
    return storage.generate_view_url(object_key_for(*parts))


def physical_upload_path(reference: str | None, upload_root: Path = UPLOAD_ROOT) -> Path | None:
    if not reference:
        return None

    parsed_path = (
        urlparse(reference).path
        if reference.startswith(("http://", "https://"))
        else reference
    )

    normalized = parsed_path.lstrip("/")
    prefix = f"{PUBLIC_UPLOAD_ROOT}/"
    if normalized == PUBLIC_UPLOAD_ROOT:
        return upload_root
    if normalized.startswith(prefix):
        return storage.local_path(normalized[len(prefix):]) or (upload_root / normalized[len(prefix):])
    candidate = Path(parsed_path)
    if candidate.is_absolute():
        return candidate
    storage_path = storage.local_path(normalized)
    if storage_path is not None:
        return storage_path
    return Path(normalized)


def physical_path_for_public_reference(reference: str, upload_root: Path = UPLOAD_ROOT) -> Path:
    path = physical_upload_path(reference, upload_root)
    if path is None:
        raise ValueError("Upload reference is empty.")
    return path


def upload_reference_for_path(path: Path, upload_root: Path = UPLOAD_ROOT) -> str:
    try:
        relative = path.resolve().relative_to(upload_root.resolve())
    except ValueError:
        return str(path)
    return public_upload_reference(str(relative))


def iter_upload_files(upload_root: Path = UPLOAD_ROOT) -> list[Path]:
    if not upload_root.exists():
        return []
    return [path for path in upload_root.rglob("*") if path.is_file()]


def file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def file_modified_at(path: Path) -> datetime | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime)
    except OSError:
        return None


def upload_file_category(path: Path, upload_root: Path = UPLOAD_ROOT) -> str:
    try:
        relative = path.relative_to(upload_root)
    except ValueError:
        relative = path

    parts = relative.parts
    name = path.name.lower()
    suffix = path.suffix.lower().lstrip(".") or "unknown"

    if parts and parts[0] == "ocr-debug":
        if "crop" in name:
            return "ocr_debug_crop"
        if "barcode-zone" in name:
            return "ocr_debug_barcode_zone"
        if "canonical" in name:
            return "ocr_debug_canonical"
        if "processed" in name:
            return "ocr_debug_processed"
        return f"ocr_debug_{suffix}"

    if "barcode-zone" in name:
        return "barcode_zone_image"
    if "canonical" in name:
        return "canonical_ocr_image"
    if "processed" in name:
        return "processed_image"
    if "crop" in name:
        return "temporary_crop"

    if parts:
        return parts[0]

    return suffix


def upload_reference_rows(db) -> list[dict]:
    from app.models.card_image import CardImage
    from app.models.fuel_reward_account import FuelRewardAccount
    from app.models.receipt import Receipt

    rows: list[dict] = []
    for image in db.query(CardImage).all():
        rows.append(
            {
                "table": "card_images",
                "id": image.id,
                "column": "original_image_url",
                "path": image.original_image_url,
            }
        )
        if image.processed_image_url:
            rows.append(
                {
                    "table": "card_images",
                    "id": image.id,
                    "column": "processed_image_url",
                    "path": image.processed_image_url,
                }
            )

    for receipt in db.query(Receipt).all():
        rows.append(
            {
                "table": "receipts",
                "id": receipt.id,
                "column": "image_url",
                "path": receipt.image_url,
            }
        )

    for account in db.query(FuelRewardAccount).all():
        if account.barcode_image_url:
            rows.append(
                {
                    "table": "fuel_reward_accounts",
                    "id": account.id,
                    "column": "barcode_image_url",
                    "path": account.barcode_image_url,
                }
            )

    return rows


def upload_reference_file_set(db, upload_root: Path = UPLOAD_ROOT) -> tuple[list[dict], set[Path]]:
    references = upload_reference_rows(db)
    referenced_file_set: set[Path] = set()

    for reference in references:
        physical_path = physical_upload_path(reference["path"], upload_root)
        if physical_path:
            referenced_file_set.add(physical_path.resolve())

    return references, referenced_file_set


def orphaned_upload_files(db, upload_root: Path = UPLOAD_ROOT) -> tuple[list[Path], list[dict], set[Path]]:
    files = iter_upload_files(upload_root)
    references, referenced_file_set = upload_reference_file_set(db, upload_root)
    orphaned_files = [
        path
        for path in files
        if path.resolve() not in referenced_file_set
    ]
    return orphaned_files, references, referenced_file_set


def serialize_orphaned_file(path: Path, upload_root: Path = UPLOAD_ROOT) -> dict:
    modified_at = file_modified_at(path)
    return {
        "path": str(path.relative_to(upload_root)),
        "category": upload_file_category(path, upload_root),
        "size_bytes": file_size(path),
        "modified_at": modified_at.isoformat() if modified_at else None,
        "age_hours": (
            round((utc_now() - modified_at).total_seconds() / 3600, 2)
            if modified_at
            else None
        ),
    }


def orphan_category_counts(paths: list[Path], upload_root: Path = UPLOAD_ROOT) -> list[dict]:
    counter = Counter(upload_file_category(path, upload_root) for path in paths)
    size_by_category = Counter()
    for path in paths:
        size_by_category[upload_file_category(path, upload_root)] += file_size(path)
    return [
        {
            "category": category,
            "count": count,
            "size_bytes": size_by_category[category],
        }
        for category, count in sorted(counter.items())
    ]


def preview_orphaned_upload_cleanup(
    db,
    *,
    older_than_days: int = 1,
    minimum_age_hours: int = 24,
    upload_root: Path = UPLOAD_ROOT,
    limit: int = 250,
) -> dict:
    ensure_upload_directories(upload_root)
    orphaned_files, references, referenced_file_set = orphaned_upload_files(db, upload_root)
    cutoff_hours = max(older_than_days * 24, minimum_age_hours)
    cutoff = utc_now() - timedelta(hours=cutoff_hours)
    eligible_files: list[Path] = []
    recent_files: list[Path] = []
    next_eligible_at: datetime | None = None

    for path in orphaned_files:
        modified_at = file_modified_at(path)
        if modified_at is not None and modified_at <= cutoff:
            eligible_files.append(path)
        else:
            recent_files.append(path)
            if modified_at is not None:
                protected_until = modified_at + timedelta(hours=cutoff_hours)
                if next_eligible_at is None or protected_until < next_eligible_at:
                    next_eligible_at = protected_until

    return {
        "upload_root": str(upload_root),
        "older_than_days": older_than_days,
        "minimum_age_hours": minimum_age_hours,
        "db_reference_count": len(references),
        "referenced_file_count": len(referenced_file_set),
        "orphaned_file_count": len(orphaned_files),
        "protected_recent_file_count": len(recent_files),
        "eligible_file_count": len(eligible_files),
        "recent_or_unknown_file_count": len(recent_files),
        "eligible_bytes": sum(file_size(path) for path in eligible_files),
        "next_eligible_cleanup_time": next_eligible_at.isoformat() if next_eligible_at else None,
        "protection_explanation": (
            f"Orphaned files are protected until they are at least {cutoff_hours} hours old."
            if recent_files
            else None
        ),
        "category_counts": orphan_category_counts(orphaned_files, upload_root),
        "eligible_category_counts": orphan_category_counts(eligible_files, upload_root),
        "orphaned_files": [
            serialize_orphaned_file(path, upload_root)
            for path in orphaned_files[:limit]
        ],
        "eligible_files": [
            serialize_orphaned_file(path, upload_root)
            for path in eligible_files[:limit]
        ],
        "protected_files": [
            {
                **serialize_orphaned_file(path, upload_root),
                "protection_reason": (
                    f"Protected until at least {cutoff_hours} hours old."
                    if file_modified_at(path)
                    else "Protected because file age could not be read."
                ),
                "protected_until": (
                    (modified_at + timedelta(hours=cutoff_hours)).isoformat()
                    if (modified_at := file_modified_at(path))
                    else None
                ),
            }
            for path in recent_files[:limit]
        ],
    }


def delete_orphaned_uploads(
    db,
    *,
    older_than_days: int = 1,
    minimum_age_hours: int = 24,
    dry_run: bool = True,
    upload_root: Path = UPLOAD_ROOT,
) -> dict:
    preview = preview_orphaned_upload_cleanup(
        db,
        older_than_days=older_than_days,
        minimum_age_hours=minimum_age_hours,
        upload_root=upload_root,
        limit=1000,
    )
    deleted_files = []
    failed_files = []

    if not dry_run:
        _, referenced_file_set = upload_reference_file_set(db, upload_root)
        for item in preview["eligible_files"]:
            path = (upload_root / item["path"]).resolve()
            if path in referenced_file_set:
                continue
            try:
                path.unlink()
                deleted_files.append(item)
            except OSError as exc:
                logger.warning(
                    "Failed to delete orphaned upload file.",
                    extra={"path": str(path), "error": str(exc)},
                )
                failed_files.append({**item, "error": str(exc)})

    return {
        **preview,
        "dry_run": dry_run,
        "deleted_count": 0 if dry_run else len(deleted_files),
        "deleted_bytes": 0 if dry_run else sum(item["size_bytes"] for item in deleted_files),
        "failed_count": len(failed_files),
        "deleted_files": deleted_files,
        "failed_files": failed_files,
    }


def build_upload_health_report(db, upload_root: Path = UPLOAD_ROOT) -> dict:
    ensure_upload_directories(upload_root)
    files = iter_upload_files(upload_root)
    file_set = {path.resolve() for path in files}
    references = upload_reference_rows(db)
    resolved_references = []
    referenced_file_set: set[Path] = set()
    missing_references = []

    for reference in references:
        physical_path = physical_upload_path(reference["path"], upload_root)
        exists = bool(physical_path and physical_path.exists() and physical_path.is_file())
        if physical_path:
            resolved_path = physical_path.resolve()
            referenced_file_set.add(resolved_path)
        else:
            resolved_path = None
        row = {
            **reference,
            "physical_path": str(physical_path) if physical_path else None,
            "exists": exists,
        }
        resolved_references.append(row)
        if not exists:
            missing_references.append(row)

    orphaned_files = [
        path
        for path in files
        if path.resolve() not in referenced_file_set
    ]
    ocr_debug_dir = upload_root / "ocr-debug"
    ocr_debug_files = [
        path
        for path in ocr_debug_dir.rglob("*")
        if path.is_file()
    ] if ocr_debug_dir.exists() else []

    return {
        "upload_root": str(upload_root),
        "public_root": PUBLIC_UPLOAD_ROOT,
        "total_upload_files": len(files),
        "total_upload_bytes": sum(file_size(path) for path in files),
        "db_reference_count": len(references),
        "missing_file_reference_count": len(missing_references),
        "orphaned_file_count": len(orphaned_files),
        "orphaned_file_type_counts": orphan_category_counts(orphaned_files, upload_root),
        "ocr_debug_file_count": len(ocr_debug_files),
        "ocr_debug_bytes": sum(file_size(path) for path in ocr_debug_files),
        "missing_file_references": missing_references[:100],
        "orphaned_files": [
            serialize_orphaned_file(path, upload_root)
            for path in orphaned_files[:100]
        ],
    }


def warn_if_uploads_empty_but_db_references(db, upload_root: Path = UPLOAD_ROOT) -> None:
    references = upload_reference_rows(db)
    non_debug_files = [
        path
        for path in iter_upload_files(upload_root)
        if "ocr-debug" not in path.relative_to(upload_root).parts
    ]
    if references and not non_debug_files:
        logger.warning(
            "Uploads directory is empty but database references upload files.",
            extra={
                "upload_root": str(upload_root),
                "db_reference_count": len(references),
            },
        )
