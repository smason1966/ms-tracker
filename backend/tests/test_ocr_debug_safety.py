from __future__ import annotations

import os
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.services.ocr_debug import OCRDebugRun, cleanup_ocr_debug_files, purge_temp_ocr_crops


class OCRDebugSafetyTest(unittest.TestCase):
    def test_debug_run_respects_file_cap(self) -> None:
        debug_run = OCRDebugRun(enabled=True, max_files=2)

        self.assertTrue(debug_run.reserve_file())
        self.assertTrue(debug_run.reserve_file())
        self.assertFalse(debug_run.reserve_file())

    def test_cleanup_deletes_only_old_pngs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            debug_dir = Path(temp_dir)
            old_png = debug_dir / "old.png"
            fresh_png = debug_dir / "fresh.png"
            old_txt = debug_dir / "old.txt"

            old_png.write_bytes(b"old")
            fresh_png.write_bytes(b"fresh")
            old_txt.write_text("old", encoding="utf-8")

            old_timestamp = time.time() - (25 * 60 * 60)
            os.utime(old_png, (old_timestamp, old_timestamp))
            os.utime(old_txt, (old_timestamp, old_timestamp))

            result = cleanup_ocr_debug_files(debug_dir=debug_dir)

            self.assertEqual(result["deleted"], 1)
            self.assertFalse(old_png.exists())
            self.assertTrue(fresh_png.exists())
            self.assertTrue(old_txt.exists())

    def test_cleanup_can_enforce_max_folder_size(self) -> None:
        with TemporaryDirectory() as temp_dir:
            debug_dir = Path(temp_dir)
            oldest_png = debug_dir / "oldest.png"
            newest_png = debug_dir / "newest.png"
            oldest_png.write_bytes(b"x" * 800_000)
            newest_png.write_bytes(b"x" * 800_000)

            old_timestamp = time.time() - 60
            os.utime(oldest_png, (old_timestamp, old_timestamp))

            result = cleanup_ocr_debug_files(
                debug_dir=debug_dir,
                older_than_hours=24,
                max_folder_size_mb=1,
            )

            self.assertEqual(result["deleted_for_size_limit"], 1)
            self.assertFalse(oldest_png.exists())
            self.assertTrue(newest_png.exists())

    def test_purge_temp_ocr_crops_deletes_pngs_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            crop = temp_path / "crop.png"
            barcode_crop = temp_path / "barcode-crop.jpg"
            note = temp_path / "note.txt"
            crop.write_bytes(b"crop")
            barcode_crop.write_bytes(b"barcode")
            note.write_text("keep", encoding="utf-8")

            result = purge_temp_ocr_crops(temp_path)

            self.assertEqual(result["deleted"], 2)
            self.assertFalse(crop.exists())
            self.assertFalse(barcode_crop.exists())
            self.assertTrue(note.exists())
