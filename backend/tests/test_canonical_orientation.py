from __future__ import annotations

import unittest
from pathlib import Path

try:
    import cv2
    import numpy as np
except ModuleNotFoundError:  # pragma: no cover - local env may not include OCR deps
    cv2 = None
    np = None

from app.services.image_preprocessing import (
    normalize_card_orientation_with_metadata,
    read_image_respecting_exif,
    rotate_image_for_ocr,
)


@unittest.skipIf(cv2 is None or np is None, "OpenCV/numpy OCR dependencies unavailable")
class CanonicalOrientationTest(unittest.TestCase):
    def synthetic_card(self, brand: str = "BEST BUY") -> np.ndarray:
        image = np.full((360, 720, 3), 255, np.uint8)
        cv2.rectangle(image, (20, 20), (700, 340), (20, 20, 20), 3)
        cv2.putText(
            image,
            brand,
            (50, 90),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.8,
            (0, 0, 0),
            4,
            cv2.LINE_AA,
        )
        cv2.putText(
            image,
            "GIFT CARD",
            (50, 150),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.1,
            (0, 0, 0),
            3,
            cv2.LINE_AA,
        )
        cv2.putText(
            image,
            "CARD NUMBER 6332 2600 7402 1047",
            (50, 220),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (0, 0, 0),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            image,
            "PIN 9853",
            (50, 285),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 0, 0),
            3,
            cv2.LINE_AA,
        )
        return image

    def assert_upright_best_buy(self, uploaded_rotation: int) -> None:
        uploaded_image = rotate_image_for_ocr(self.synthetic_card(), uploaded_rotation)
        result = normalize_card_orientation_with_metadata(
            uploaded_image,
            brand="Best Buy",
        )

        self.assertGreater(result.image.shape[1], result.image.shape[0])
        self.assertIn(result.rotation_degrees, {0, 90, 180, 270})
        self.assertIn("human-readable", result.reason_selected)
        self.assertEqual(len(result.tested_rotations), 4)
        self.assertTrue(
            any(
                trial["rotation_degrees"] == result.rotation_degrees
                for trial in result.tested_rotations
            )
        )

    def test_upside_down_best_buy_normalizes_to_upright_landscape(self) -> None:
        self.assert_upright_best_buy(180)

    def test_sideways_best_buy_normalizes_to_upright_landscape(self) -> None:
        self.assert_upright_best_buy(90)

    def test_rotated_nike_normalizes_to_upright_landscape(self) -> None:
        uploaded_image = rotate_image_for_ocr(self.synthetic_card("NIKE"), 270)
        result = normalize_card_orientation_with_metadata(
            uploaded_image,
            brand="Nike",
        )

        self.assertGreater(result.image.shape[1], result.image.shape[0])
        self.assertIn(result.rotation_degrees, {0, 90, 180, 270})
        self.assertIn("human-readable", result.reason_selected)

    def test_existing_upload_fixtures_can_be_reprocessed(self) -> None:
        upload_dir = Path(__file__).resolve().parents[1] / "uploads" / "card-images"
        fixture_paths = [
            path
            for path in sorted(upload_dir.glob("*"))
            if path.suffix.lower() in {".jpg", ".jpeg", ".png"}
            and not path.name.startswith(("processed-", "canonical-"))
        ][:3]

        if not fixture_paths:
            self.skipTest("No existing card image uploads available")

        for fixture_path in fixture_paths:
            with self.subTest(path=fixture_path.name):
                image = read_image_respecting_exif(str(fixture_path))
                self.assertIsNotNone(image)
                result = normalize_card_orientation_with_metadata(image)
                self.assertGreaterEqual(result.image.shape[1], result.image.shape[0])
                self.assertEqual(len(result.tested_rotations), 4)
                self.assertTrue(result.reason_selected)
