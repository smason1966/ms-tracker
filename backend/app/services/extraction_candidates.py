import re
from dataclasses import dataclass


@dataclass
class ExtractionCandidate:
    candidate_type: str  # card_number or pin
    source: str  # barcode or ocr
    value: str
    confidence_score: float
    notes: str


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value)


def extract_barcode_values(raw_text: str) -> list[str]:
    if "BARCODE_CANDIDATES:" not in raw_text:
        return []

    barcode_section = raw_text.split("BARCODE_CANDIDATES:", 1)[1]
    values: list[str] = []

    for line in barcode_section.splitlines():
        value = digits_only(line)

        if len(value) >= 8 and value not in values:
            values.append(value)

    return values


def extract_ocr_number_values(raw_text: str) -> list[str]:
    values: list[str] = []

    matches = re.findall(r"(?:\d[\s-]?){8,40}", raw_text)

    for match in matches:
        value = digits_only(match)

        if len(value) >= 8 and value not in values:
            values.append(value)

    return values


def extract_ocr_pin_values(raw_text: str) -> list[str]:
    values: list[str] = []

    matches = re.findall(
        r"(?:PIN|Pin|pin)[^\d]{0,30}(\d{3,8})",
        raw_text,
    )

    ignored_values = {"2024", "2025", "2026", "0525"}

    for match in matches:
        value = digits_only(match)

        if value and value not in ignored_values and value not in values:
            values.append(value)

    return values


def build_extraction_candidates(raw_text: str) -> list[ExtractionCandidate]:
    candidates: list[ExtractionCandidate] = []

    for value in extract_barcode_values(raw_text):
        if len(value) == 16:
            confidence = 0.9
            notes = "16-digit barcode candidate."
        elif 12 <= len(value) <= 24:
            confidence = 0.75
            notes = "Reasonable-length barcode candidate."
        else:
            confidence = 0.35
            notes = "Long barcode candidate; may be POS/purchase barcode."

        candidates.append(
            ExtractionCandidate(
                candidate_type="card_number",
                source="barcode",
                value=value,
                confidence_score=confidence,
                notes=notes,
            )
        )

    for value in extract_ocr_number_values(raw_text):
        if len(value) == 16:
            confidence = 0.65
            notes = "16-digit OCR candidate."
        elif 12 <= len(value) <= 24:
            confidence = 0.45
            notes = "Reasonable-length OCR candidate."
        else:
            confidence = 0.2
            notes = "Long OCR candidate; may be unrelated text."

        candidates.append(
            ExtractionCandidate(
                candidate_type="card_number",
                source="ocr",
                value=value,
                confidence_score=confidence,
                notes=notes,
            )
        )

    for value in extract_ocr_pin_values(raw_text):
        candidates.append(
            ExtractionCandidate(
                candidate_type="pin",
                source="ocr",
                value=value,
                confidence_score=0.55,
                notes="PIN-like OCR candidate near PIN label.",
            )
        )

    return candidates
