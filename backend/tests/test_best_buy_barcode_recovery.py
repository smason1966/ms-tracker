from __future__ import annotations

import unittest
from pathlib import Path

from app.services import barcode as barcode_service
from app.api.card_images import (
    auto_orientation_priority,
    auto_select_review_ocr_orientation,
    collect_barcode_zone_attempts,
    collect_best_buy_barcode_attempts,
    zone_to_image_space,
)
from app.models.card_image import CardImage
from app.services.extraction_candidates import build_extraction_candidates
from app.services.image_preprocessing import save_rotated_canonical_image


BARCODE_DECODER_AVAILABLE = barcode_service.decode is not None


class BestBuyBarcodeRecoveryTest(unittest.TestCase):
    @unittest.skipUnless(BARCODE_DECODER_AVAILABLE, "zbar barcode decoder unavailable")
    def test_existing_best_buy_upload_yields_barcode_card_candidate(self) -> None:
        upload_path = (
            Path(__file__).resolve().parents[1]
            / "uploads"
            / "card-images"
            / "fb12f914-8f18-42d3-a95e-df6e84b11ed6.jpg"
        )
        if not upload_path.exists():
            self.skipTest("Existing Best Buy upload fixture is unavailable")

        image = CardImage(
            gift_card_id=8,
            image_type="primary",
            original_image_url=str(upload_path),
        )
        attempts, accepted_values = collect_best_buy_barcode_attempts(
            image,
            "Best Buy",
        )

        self.assertIn("6339935295750149", accepted_values)
        self.assertTrue(
            any(
                attempt["source"] == "original"
                and attempt["detected"]
                and attempt["accepted"]
                for attempt in attempts
            )
        )

        raw_text = "BARCODE_CANDIDATES:\n" + "\n".join(accepted_values)
        candidates = [
            candidate
            for candidate in build_extraction_candidates(raw_text, brand="Best Buy")
            if candidate.candidate_type != "rejected"
        ]

        self.assertGreaterEqual(len(candidates), 1)
        self.assertEqual(candidates[0].candidate_type, "card_number")
        self.assertEqual(candidates[0].source, "barcode")
        self.assertEqual(candidates[0].value, "6339935295750149")

    @unittest.skipUnless(BARCODE_DECODER_AVAILABLE, "zbar barcode decoder unavailable")
    def test_best_buy_barcode_zone_uses_decoder_not_ocr(self) -> None:
        upload_path = (
            Path(__file__).resolve().parents[1]
            / "uploads"
            / "card-images"
            / "fb12f914-8f18-42d3-a95e-df6e84b11ed6.jpg"
        )
        if not upload_path.exists():
            self.skipTest("Existing Best Buy upload fixture is unavailable")

        debug_paths: list[str] = []
        try:
            attempts, accepted_values, debug_paths = collect_barcode_zone_attempts(
                image_path=str(upload_path),
                brand="Best Buy",
                source="barcode_zone",
                zone={
                    "zone_name": "best_buy_barcode",
                    "x_pct": 0,
                    "y_pct": 0,
                    "width_pct": 100,
                    "height_pct": 100,
                },
            )

            self.assertIn("6339935295750149", accepted_values)
            self.assertGreaterEqual(len(debug_paths), 1)
            self.assertTrue(
                any(
                    attempt["source"] == "barcode_zone"
                    and attempt["zone_name"] == "best_buy_barcode"
                    and attempt["accepted"]
                    for attempt in attempts
                )
            )
        finally:
            for debug_path in debug_paths:
                Path(debug_path).unlink(missing_ok=True)

    def test_manual_saved_review_ocr_image_persists_rotation_and_dimensions(self) -> None:
        upload_path = (
            Path(__file__).resolve().parents[1]
            / "uploads"
            / "card-images"
            / "fb12f914-8f18-42d3-a95e-df6e84b11ed6.jpg"
        )
        if not upload_path.exists():
            self.skipTest("Existing Best Buy upload fixture is unavailable")

        saved_path, metadata = save_rotated_canonical_image(
            str(upload_path),
            upload_path.parent,
            rotation_degrees=90,
        )
        saved_file = Path(saved_path)

        try:
            self.assertTrue(saved_file.exists())
            self.assertEqual(metadata["rotation_degrees"], 90)
            self.assertGreater(metadata["width"], 0)
            self.assertGreater(metadata["height"], 0)
        finally:
            saved_file.unlink(missing_ok=True)

    def test_auto_orientation_priority_prefers_best_buy_barcode(self) -> None:
        barcode_candidates = build_extraction_candidates(
            "BARCODE_CANDIDATES:\n6339935295750149",
            brand="Best Buy",
        )
        ocr_candidates = build_extraction_candidates(
            "Card 6339935295750149",
            brand="Best Buy",
        )
        barcode_trial = {
            "selected_card_number": "6339935295750149",
            "selected_pin": None,
            "selected_confidence": 0.92,
            "score": 1.3,
            "combined_text": "BARCODE_CANDIDATES:\n6339935295750149",
            "candidates": barcode_candidates,
        }
        ocr_trial = {
            "selected_card_number": "6339935295750149",
            "selected_pin": "1234",
            "selected_confidence": 0.98,
            "score": 2.0,
            "combined_text": "Card 6339935295750149 PIN 1234",
            "candidates": ocr_candidates,
        }

        self.assertGreater(
            auto_orientation_priority(barcode_trial, "Best Buy"),
            auto_orientation_priority(ocr_trial, "Best Buy"),
        )

    def test_card_boundary_relative_zone_translates_to_image_space(self) -> None:
        zone = {
            "zone_name": "best_buy_barcode",
            "zone_type": "barcode",
            "x_pct": 10,
            "y_pct": 50,
            "width_pct": 60,
            "height_pct": 20,
        }
        boundary = {
            "zone_name": "card_boundary",
            "zone_type": "card_boundary",
            "x_pct": 5,
            "y_pct": 10,
            "width_pct": 80,
            "height_pct": 50,
        }

        transformed = zone_to_image_space(zone, boundary)

        self.assertAlmostEqual(transformed["x_pct"], 13)
        self.assertAlmostEqual(transformed["y_pct"], 35)
        self.assertAlmostEqual(transformed["width_pct"], 48)
        self.assertAlmostEqual(transformed["height_pct"], 10)
        self.assertEqual(
            transformed["source_coordinate_mode"],
            "card_boundary_relative",
        )

    def test_auto_orientation_priority_prefers_nike_card_pin_pair(self) -> None:
        no_pair_trial = {
            "selected_card_number": "6060101234567890123",
            "selected_pin": None,
            "selected_confidence": 0.95,
            "score": 1.9,
            "combined_text": "6060101234567890123",
            "candidates": [],
        }
        pair_trial = {
            "selected_card_number": "6060101234567890123",
            "selected_pin": "123456",
            "selected_confidence": 0.82,
            "score": 1.4,
            "combined_text": "6060101234567890123 PIN 123456",
            "candidates": [],
        }

        self.assertGreater(
            auto_orientation_priority(pair_trial, "Nike"),
            auto_orientation_priority(no_pair_trial, "Nike"),
        )

    @unittest.skipUnless(BARCODE_DECODER_AVAILABLE, "zbar barcode decoder unavailable")
    def test_best_buy_rotated_upload_auto_orientation_saves_review_image(self) -> None:
        upload_path = (
            Path(__file__).resolve().parents[1]
            / "uploads"
            / "card-images"
            / "fb12f914-8f18-42d3-a95e-df6e84b11ed6.jpg"
        )
        if not upload_path.exists():
            self.skipTest("Existing Best Buy upload fixture is unavailable")

        image = CardImage(
            gift_card_id=8,
            image_type="primary",
            original_image_url=str(upload_path),
        )
        saved_path, _, metadata = auto_select_review_ocr_orientation(
            image,
            brand="Best Buy",
            rules=None,
            template_layouts=[],
        )
        saved_file = Path(saved_path)

        try:
            self.assertTrue(saved_file.exists())
            self.assertEqual(metadata["orientation_source"], "auto")
            self.assertIn(metadata["rotation_degrees"], {0, 90, 180, 270})
            self.assertTrue(
                any(
                    trial["valid_barcode"]
                    for trial in metadata["tested_rotations"]
                )
            )
            self.assertEqual(
                metadata["coordinate_space"],
                "saved_review_ocr_image_percent",
            )
        finally:
            saved_file.unlink(missing_ok=True)

    @unittest.skipUnless(BARCODE_DECODER_AVAILABLE, "zbar barcode decoder unavailable")
    def test_nike_rotated_upload_auto_orientation_finds_card_pin_pair(self) -> None:
        upload_path = (
            Path(__file__).resolve().parents[1]
            / "uploads"
            / "card-images"
            / "d9a322af-78db-4c19-9624-9bcadc3e3082.jpg"
        )
        if not upload_path.exists():
            self.skipTest("Existing Nike upload fixture is unavailable")

        image = CardImage(
            gift_card_id=101,
            image_type="primary",
            original_image_url=str(upload_path),
        )
        saved_path, _, metadata = auto_select_review_ocr_orientation(
            image,
            brand="Nike",
            rules=None,
            template_layouts=[],
        )
        saved_file = Path(saved_path)

        try:
            self.assertTrue(saved_file.exists())
            self.assertEqual(metadata["orientation_source"], "auto")
            self.assertIn(metadata["rotation_degrees"], {0, 90, 180, 270})
            self.assertTrue(
                any(
                    trial["card_number"] and trial["pin"]
                    for trial in metadata["tested_rotations"]
                )
            )
        finally:
            saved_file.unlink(missing_ok=True)
