import re
from dataclasses import dataclass


@dataclass
class ParsedCardData:
    card_number: str | None
    pin: str | None
    confidence_score: float
    notes: str


def normalize_text(raw_text: str) -> str:
    return raw_text.replace("\n", " ").replace("\t", " ").strip()


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value)


def extract_barcode_candidates(raw_text: str) -> list[str]:
    if "BARCODE_CANDIDATES:" not in raw_text:
        return []

    barcode_section = raw_text.split("BARCODE_CANDIDATES:", 1)[1]

    candidates: list[str] = []

    for line in barcode_section.splitlines():
        value = digits_only(line)

        if len(value) >= 8 and value not in candidates:
            candidates.append(value)

    return candidates


def find_numeric_candidates(text: str) -> list[str]:
    candidates = re.findall(r"(?:\d[\s-]?){8,40}", text)

    results: list[str] = []

    for candidate in candidates:
        value = digits_only(candidate)

        if len(value) >= 8 and value not in results:
            results.append(value)

    return results


def find_pin_candidates(text: str) -> list[str]:
    pin_nearby = re.findall(
        r"(?:PIN|Pin|pin)[^\d]{0,30}(\d{3,8})",
        text,
    )

    filtered = [
        pin for pin in pin_nearby if pin not in {"2024", "2025", "2026", "0525"}
    ]

    return filtered


def choose_card_number(raw_text: str) -> str | None:
    barcode_candidates = extract_barcode_candidates(raw_text)

    # Prefer clean 16-digit barcode candidates.
    for candidate in barcode_candidates:
        if len(candidate) == 16:
            return candidate

    # Deprioritize long POS/purchase barcodes.
    barcode_reasonable = [
        candidate for candidate in barcode_candidates if 12 <= len(candidate) <= 24
    ]

    if barcode_reasonable:
        return barcode_reasonable[0]

    all_numbers = find_numeric_candidates(raw_text)

    sixteen_digit_numbers = [number for number in all_numbers if len(number) == 16]

    if sixteen_digit_numbers:
        return sixteen_digit_numbers[0]

    reasonable_numbers = [number for number in all_numbers if 12 <= len(number) <= 24]

    if reasonable_numbers:
        return max(reasonable_numbers, key=len)

    return None


def parse_best_buy(text: str) -> ParsedCardData:
    card_number = choose_card_number(text)
    pins = find_pin_candidates(text)
    pin = pins[0] if pins else None

    confidence = 0.1

    if card_number:
        confidence += 0.65

    if pin:
        confidence += 0.2

    return ParsedCardData(
        card_number=card_number,
        pin=pin,
        confidence_score=min(confidence, 0.95),
        notes="Best Buy parser. Barcode candidates preferred. Human verification required.",
    )


def parse_generic(text: str) -> ParsedCardData:
    card_number = choose_card_number(text)
    pins = find_pin_candidates(text)
    pin = pins[0] if pins else None

    confidence = 0.1

    if card_number:
        confidence += 0.55

    if pin:
        confidence += 0.2

    return ParsedCardData(
        card_number=card_number,
        pin=pin,
        confidence_score=min(confidence, 0.85),
        notes="Generic parser. Barcode candidates preferred. Human verification required.",
    )


def parse_card_data(raw_text: str, brand: str | None = None) -> ParsedCardData:
    brand_normalized = (brand or "").strip().lower()

    if "best buy" in brand_normalized:
        return parse_best_buy(raw_text)

    return parse_generic(raw_text)
