from __future__ import annotations

import logging
import os
import threading
import tempfile
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterator

from app.services.upload_storage import upload_dir

logger = logging.getLogger(__name__)

OCR_DEBUG_DIR = upload_dir("ocr-debug")
OCR_TEMP_DIR = Path(tempfile.gettempdir()) / "ms-tracker-ocr"
OCR_DEBUG_WRITE_WARNING = "OCR debug artifact skipped due to disk/write error."
OCR_DEBUG_RETENTION_HOURS = 24
DEFAULT_OCR_DEBUG_MAX_FILES = 40


def truthy_env(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def ocr_debug_enabled_from_env() -> bool:
    return truthy_env(os.getenv("OCR_DEBUG"))


def ocr_debug_max_files_from_env() -> int:
    try:
        return max(0, int(os.getenv("OCR_DEBUG_MAX_FILES", str(DEFAULT_OCR_DEBUG_MAX_FILES))))
    except ValueError:
        return DEFAULT_OCR_DEBUG_MAX_FILES


class OCRDebugRun:
    def __init__(self, *, enabled: bool, max_files: int) -> None:
        self.enabled = enabled
        self.max_files = max(0, max_files)
        self._written = 0
        self._lock = threading.Lock()

    def reserve_file(self) -> bool:
        if not self.enabled:
            return False
        with self._lock:
            if self._written >= self.max_files:
                return False
            self._written += 1
            return True


_debug_run: ContextVar[OCRDebugRun] = ContextVar(
    "ocr_debug_run",
    default=OCRDebugRun(enabled=False, max_files=0),
)


def current_ocr_debug_run() -> OCRDebugRun:
    return _debug_run.get()


@contextmanager
def ocr_debug_run(
    *,
    enabled: bool | None = None,
    max_files: int | None = None,
) -> Iterator[OCRDebugRun]:
    run = OCRDebugRun(
        enabled=ocr_debug_enabled_from_env() if enabled is None else enabled,
        max_files=ocr_debug_max_files_from_env() if max_files is None else max_files,
    )
    token = _debug_run.set(run)
    try:
        yield run
    finally:
        _debug_run.reset(token)


def cleanup_ocr_debug_files(
    *,
    older_than_hours: int = OCR_DEBUG_RETENTION_HOURS,
    debug_dir: Path = OCR_DEBUG_DIR,
    max_folder_size_mb: int | None = None,
) -> dict:
    cutoff = datetime.now().timestamp() - timedelta(hours=older_than_hours).total_seconds()
    deleted = 0
    skipped = 0

    if not debug_dir.exists():
        return {"deleted": deleted, "skipped": skipped, "debug_dir": str(debug_dir)}

    for path in debug_dir.glob("*.png"):
        try:
            if not path.is_file() or path.stat().st_mtime >= cutoff:
                continue
            path.unlink()
            deleted += 1
        except OSError:
            skipped += 1
            logger.warning(OCR_DEBUG_WRITE_WARNING, exc_info=True)

    size_deleted = 0
    max_bytes = None if max_folder_size_mb is None else max(0, max_folder_size_mb) * 1024 * 1024
    if max_bytes is not None:
        try:
            files = sorted(
                [path for path in debug_dir.glob("*.png") if path.is_file()],
                key=lambda path: path.stat().st_mtime,
            )
            total_size = sum(path.stat().st_size for path in files)
            for path in files:
                if total_size <= max_bytes:
                    break
                file_size = path.stat().st_size
                path.unlink()
                deleted += 1
                size_deleted += 1
                total_size -= file_size
        except OSError:
            skipped += 1
            logger.warning(OCR_DEBUG_WRITE_WARNING, exc_info=True)

    return {
        "deleted": deleted,
        "deleted_for_size_limit": size_deleted,
        "skipped": skipped,
        "debug_dir": str(debug_dir),
        "retention_hours": older_than_hours,
        "max_folder_size_mb": max_folder_size_mb,
    }


def purge_temp_ocr_crops(temp_dir: Path = OCR_TEMP_DIR) -> dict:
    deleted = 0
    skipped = 0

    if not temp_dir.exists():
        return {"deleted": deleted, "skipped": skipped, "temp_dir": str(temp_dir)}

    for path in temp_dir.iterdir():
        try:
            if not path.is_file() or path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
                continue
            path.unlink()
            deleted += 1
        except OSError:
            skipped += 1
            logger.warning(OCR_DEBUG_WRITE_WARNING, exc_info=True)

    return {"deleted": deleted, "skipped": skipped, "temp_dir": str(temp_dir)}
