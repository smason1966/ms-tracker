import unittest

from app.services.extraction_candidates import (
    BrandParsingRules,
    build_extraction_candidates,
)


BEST_BUY_RULES = BrandParsingRules(
    card_number_regex=r"(?:CARD\s*#?|CARD\s*NUMBER)[^\d]{0,40}((?:\d[\s-]?){16})",
    pin_regex=r"\bPIN\s*[:#-]?\s*(\d{4})\b",
    pin_label_keywords="PIN",
    expected_pin_length=4,
    card_number_source_priority="barcode,ocr",
    pin_spatial_rule="four_digits_right_of_card_number",
)


class BestBuyPinDetectionTest(unittest.TestCase):
    def useful_candidates(self, raw_text: str, brand: str):
        return [
            candidate
            for candidate in build_extraction_candidates(
                raw_text,
                brand=brand,
                rules=BEST_BUY_RULES,
            )
            if candidate.candidate_type != "rejected"
        ]

    def test_prefers_pin_near_card_number_over_edge_code(self) -> None:
        raw_text = """
BEST BUY
CARD # 6332 2600 7402 1047     9853
edge barcode code 1124
date 0525 product 0020337

OCR_SPATIAL_TOKENS:
CARD|45|122|38|16|1
#|88|122|10|16|1
6332|120|122|43|16|1
2600|172|122|43|16|1
7402|224|122|43|16|1
1047|276|122|43|16|1
9853|354|124|42|16|1
barcode|610|124|48|16|1
1124|666|124|40|16|1
0525|700|410|40|16|6

BARCODE_CANDIDATES:
6332260074021047
"""

        pin_candidates = [
            candidate
            for candidate in build_extraction_candidates(
                raw_text,
                brand="Best Buy",
                rules=BEST_BUY_RULES,
            )
            if candidate.candidate_type == "pin"
        ]

        self.assertGreaterEqual(len(pin_candidates), 1)
        self.assertEqual(pin_candidates[0].value, "9853")
        self.assertIn("near card number", pin_candidates[0].notes)

        edge_candidates = [
            candidate for candidate in pin_candidates if candidate.value == "1124"
        ]

        if edge_candidates:
            self.assertLess(
                edge_candidates[0].confidence_score,
                pin_candidates[0].confidence_score,
            )

    def test_best_buy_barcode_beats_bad_zone_fragments(self) -> None:
        raw_text = """
BEST BUY

OCR_ZONE_CROPS:
ZONE|best_buy_card_number_zone|card_number|1||16|20|30|40|12
18981240
ENDZONE
ZONE|best_buy_barcode_zone|barcode|1||16|20|50|50|14
BARCODE_CANDIDATES:
431443228
ENDZONE

BARCODE_CANDIDATES:
6332260074021047
"""

        candidates = build_extraction_candidates(
            raw_text,
            brand="Best Buy",
            rules=BEST_BUY_RULES,
        )
        useful_candidates = [
            candidate for candidate in candidates if candidate.candidate_type != "rejected"
        ]
        rejected_candidates = [
            candidate for candidate in candidates if candidate.candidate_type == "rejected"
        ]

        self.assertEqual(useful_candidates[0].value, "6332260074021047")
        self.assertEqual(useful_candidates[0].source, "barcode")
        self.assertTrue(any(candidate.value == "18981240" for candidate in rejected_candidates))
        self.assertTrue(any(candidate.value == "431443228" for candidate in rejected_candidates))


class RedemptionCodeDetectionTest(unittest.TestCase):
    def useful_candidates(self, raw_text: str, brand: str):
        return [
            candidate
            for candidate in build_extraction_candidates(raw_text, brand=brand)
            if candidate.candidate_type != "rejected"
        ]

    def test_uber_detects_redemption_code_without_pin_candidates(self) -> None:
        raw_text = """
UBER
GIFT CODE
NAAD XDHU 3NKE M9CD
numeric tracking 123456789012
"""

        candidates = self.useful_candidates(raw_text, "Uber")
        pin_candidates = [
            candidate
            for candidate in build_extraction_candidates(raw_text, brand="Uber")
            if candidate.candidate_type == "pin"
        ]

        self.assertEqual(candidates[0].value, "NAAD XDHU 3NKE M9CD")
        self.assertEqual(candidates[0].candidate_type, "card_number")
        self.assertEqual(pin_candidates, [])

    def test_doordash_detects_redemption_code_without_pin_candidates(self) -> None:
        raw_text = """
DoorDash
PIN / redemption area
NAAW GJTM 9BZE QN8V
small print 0924 6536
"""

        candidates = self.useful_candidates(raw_text, "DoorDash")
        pin_candidates = [
            candidate
            for candidate in build_extraction_candidates(raw_text, brand="DoorDash")
            if candidate.candidate_type == "pin"
        ]

        self.assertEqual(candidates[0].value, "NAAW GJTM 9BZE QN8V")
        self.assertEqual(candidates[0].candidate_type, "card_number")
        self.assertEqual(pin_candidates, [])

    def test_doordash_returns_low_confidence_near_prefix_candidate(self) -> None:
        raw_text = "DoorDash scratched code NAAV GJTM 9BZE QN8V"

        candidates = self.useful_candidates(raw_text, "DoorDash")

        self.assertEqual(candidates[0].value, "NAAW GJTM 9BZE QN8V")
        self.assertLess(candidates[0].confidence_score, 0.8)
        self.assertIn("Low confidence", candidates[0].notes)

    def test_doordash_strips_embedded_ocr_noise_around_prefix(self) -> None:
        raw_text = "red strip OCR pass DINAAWGJTH9BZEQNBVK"

        candidates = self.useful_candidates(raw_text, "DoorDash")

        self.assertEqual(candidates[0].value, "NAAW GJTH 9BZE QNBV")
        self.assertLess(candidates[0].confidence_score, 0.8)
        self.assertIn("embedded NAAW prefix", candidates[0].notes)

    def test_uber_tolerates_dotted_or_gapped_ocr(self) -> None:
        raw_text = "Gift code N A A D. XDHU. 3NKE. M9CD"

        candidates = self.useful_candidates(raw_text, "Uber")

        self.assertEqual(candidates[0].value, "NAAD XDHU 3NKE M9CD")

    def test_zone_candidate_is_ranked_above_full_image_candidate(self) -> None:
        raw_text = """
random full image text
NAAD WRONG 1111 2222

OCR_ZONE_CROPS:
ZONE|redemption_strip|redemption_code|1||16|10|60|80|25
NAAD XDHU 3NKE M9CD
ENDZONE
"""

        candidates = self.useful_candidates(raw_text, "Uber")

        self.assertEqual(candidates[0].value, "NAAD XDHU 3NKE M9CD")
        self.assertEqual(candidates[0].source, "zone")


class NikeDetectionTest(unittest.TestCase):
    def useful_candidates(self, raw_text: str, brand: str):
        return [
            candidate
            for candidate in build_extraction_candidates(raw_text, brand=brand)
            if candidate.candidate_type != "rejected"
        ]

    def test_nike_prefers_expected_redeemable_barcode(self) -> None:
        raw_text = """
NIKE
CARD NUMBER 6060 1061 2225 3740 414
tracking barcode 123456789012

BARCODE_CANDIDATES:
123456789012
6060106122253740414
"""

        candidates = self.useful_candidates(raw_text, "Nike")

        self.assertEqual(candidates[0].value, "6060106122253740414")
        self.assertEqual(candidates[0].source, "barcode")
        self.assertIn("expected Nike", candidates[0].notes)
        self.assertIn("OCR text agrees", candidates[0].notes)

    def test_nike_detects_optional_six_digit_pin(self) -> None:
        raw_text = "NIKE scratch security code PIN 562132"

        pin_candidates = [
            candidate
            for candidate in build_extraction_candidates(raw_text, brand="Nike")
            if candidate.candidate_type == "pin"
        ]

        self.assertEqual(pin_candidates[0].value, "562132")

    def test_nike_five_digit_pin_candidate_is_rejected(self) -> None:
        raw_text = "NIKE boxed scratch area 44889"

        pin_candidates = [
            candidate
            for candidate in build_extraction_candidates(raw_text, brand="Nike")
            if candidate.candidate_type == "pin"
        ]
        card_candidates = [
            candidate
            for candidate in build_extraction_candidates(raw_text, brand="Nike")
            if candidate.candidate_type == "card_number"
        ]

        self.assertEqual(pin_candidates, [])
        self.assertEqual(card_candidates, [])

    def test_nike_redeem_barcode_zone_beats_activation_barcode_zone(self) -> None:
        raw_text = """
OCR_ZONE_CROPS:
ZONE|nike_activation_barcode|barcode|3||19|8|36|84|24
BARCODE_CANDIDATES:
77777606010825225863371199999
ENDZONE
ZONE|nike_redeem_barcode|barcode|1||19|8|70|84|20
BARCODE_CANDIDATES:
6060108252258633711
ENDZONE
ZONE|nike_card_number|card_number|1||19|10|34|80|18
6060 1082 5225 8633 711
ENDZONE
"""

        candidates = build_extraction_candidates(raw_text, brand="Nike")
        useful_candidates = [
            candidate
            for candidate in candidates
            if candidate.candidate_type != "rejected"
        ]
        rejected_candidates = [
            candidate
            for candidate in candidates
            if candidate.candidate_type == "rejected"
        ]

        self.assertEqual(useful_candidates[0].value, "6060108252258633711")
        self.assertIn("redeem barcode zone preferred", useful_candidates[0].notes)
        self.assertTrue(
            any("activation/retail barcode" in candidate.notes for candidate in rejected_candidates)
        )

    def test_nike_rejects_unrelated_bottom_number(self) -> None:
        raw_text = """
NIKE
bottom manufacturing number 9876543210987654
CARD # 6060 1082 5225 8633 711
"""

        candidates = build_extraction_candidates(raw_text, brand="Nike")
        useful_candidates = [
            candidate
            for candidate in candidates
            if candidate.candidate_type != "rejected"
        ]
        rejected_candidates = [
            candidate
            for candidate in candidates
            if candidate.candidate_type == "rejected"
        ]

        self.assertEqual(useful_candidates[0].value, "6060108252258633711")
        self.assertTrue(
            any(candidate.value == "9876543210987654" for candidate in rejected_candidates)
        )


if __name__ == "__main__":
    unittest.main()
