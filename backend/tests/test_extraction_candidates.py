import unittest

from app.services.extraction_candidates import build_extraction_candidates


class NikeBarcodeCandidateTest(unittest.TestCase):
    def test_nike_rejects_activation_barcode_and_prefers_redeem_barcode(self) -> None:
        raw_text = """
NIKE
CARD NUMBER 6060 1082 5225 8633 711

BARCODE_CANDIDATES:
77777606010825225863371199999
6060108252258633711
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
        self.assertEqual(useful_candidates[0].source, "barcode")
        self.assertTrue(
            any(
                candidate.value == "77777606010825225863371199999"
                for candidate in rejected_candidates
            )
        )

    def test_nike_rejects_16_digit_card_candidate(self) -> None:
        raw_text = """
NIKE
CARD NUMBER 6060 1012 3456 7890

BARCODE_CANDIDATES:
6060101234567890
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

        self.assertEqual(useful_candidates, [])
        self.assertTrue(
            any(
                candidate.value == "6060101234567890"
                for candidate in rejected_candidates
            )
        )


class BestBuyBarcodeCandidateTest(unittest.TestCase):
    def test_best_buy_prefers_16_digit_barcode(self) -> None:
        raw_text = """
BEST BUY
CARD # 6332 2600 7402 1047

BARCODE_CANDIDATES:
6332260074021047
123456789012
"""

        candidates = build_extraction_candidates(raw_text, brand="Best Buy")
        useful_candidates = [
            candidate
            for candidate in candidates
            if candidate.candidate_type != "rejected"
        ]

        self.assertEqual(useful_candidates[0].value, "6332260074021047")
        self.assertEqual(useful_candidates[0].source, "barcode")


if __name__ == "__main__":
    unittest.main()
