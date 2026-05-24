from __future__ import annotations

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


def plain_ocr_text(raw_text: str) -> str:
    for marker in (
        "\n\nOCR_SPATIAL_TOKENS:",
        "\n\nBARCODE_CANDIDATES:",
        "\n\nOCR_ZONE_CROPS:",
        "\n\nEXTRACTION_CANDIDATES:",
    ):
        if marker in raw_text:
            raw_text = raw_text.split(marker, 1)[0]

    return raw_text


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value)


def normalize_gift_code(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", value).upper()


def format_gift_code(value: str) -> str:
    normalized = normalize_gift_code(value)
    if len(normalized) == 16:
        return " ".join(
            normalized[index : index + 4] for index in range(0, 16, 4)
        )
    return normalized


def gift_code_prefix_pattern(prefix: str) -> str:
    separator = r"[\s.\-_]*"
    character_patterns = {
        "A": "[A4]",
        "D": "[D0O]",
        "W": "[WVU H]",
        "N": "[N]",
    }

    return separator.join(
        character_patterns.get(character, re.escape(character))
        for character in prefix
    )


def correct_gift_code_prefix(value: str, prefix: str) -> str:
    detected_prefix = (
        value[: len(prefix)]
        .replace("4", "A")
        .replace("0", "D" if prefix.endswith("D") else "O")
        .replace("O", "D" if prefix.endswith("D") else "O")
        .replace("V", "W")
        .replace("U", "W")
        .replace("H", "W")
    )

    return detected_prefix + value[len(prefix):]


def parse_prefixed_gift_code(
    text: str,
    *,
    brand_name: str,
    prefix: str,
) -> ParsedCardData | None:
    ocr_text = plain_ocr_text(text)
    separator = r"[\s.\-_]*"
    pattern = (
        rf"\b({gift_code_prefix_pattern(prefix)}{separator}[A-Z0-9]{{4}}"
        rf"{separator}[A-Z0-9]{{4}}{separator}[A-Z0-9]{{4}})\b"
    )
    match = re.search(pattern, ocr_text, flags=re.IGNORECASE)

    if not match:
        return None

    raw_gift_code = normalize_gift_code(match.group(1))
    gift_code = correct_gift_code_prefix(raw_gift_code, prefix)
    confidence = 0.97 if gift_code.startswith(prefix) and len(gift_code) == 16 else 0.76

    return ParsedCardData(
        card_number=format_gift_code(gift_code),
        pin=None,
        confidence_score=confidence,
        notes=(
            f"{brand_name} parser. Expected {prefix} gift code prefix and "
            "grouped gift-code format matched; pattern recognition preferred "
            "over raw OCR confidence."
        ),
    )


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
    candidates = re.findall(r"(?:\d[\s-]?){8,40}", plain_ocr_text(text))
    results: list[str] = []

    for candidate in candidates:
        value = digits_only(candidate)

        if len(value) >= 8 and value not in results:
            results.append(value)

    return results


def find_pin_candidates(text: str) -> list[str]:
    pin_nearby = re.findall(
        r"(?:PIN|Pin|pin)[^\d]{0,30}(\d{3,8})",
        plain_ocr_text(text),
    )

    return [pin for pin in pin_nearby if pin not in {"2024", "2025", "2026", "0525"}]


def choose_card_number(raw_text: str) -> str | None:
    barcode_candidates = extract_barcode_candidates(raw_text)

    for candidate in barcode_candidates:
        if len(candidate) == 16:
            return candidate

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


def calculate_confidence(
    text: str,
    card_number: str | None,
    pin: str | None,
    max_confidence: float,
) -> float:
    confidence = 0.1
    barcode_candidates = extract_barcode_candidates(text)

    if card_number and card_number in barcode_candidates and len(card_number) == 16:
        confidence = 0.9
    elif card_number and card_number in barcode_candidates:
        confidence = 0.8
    elif card_number:
        confidence += 0.55

    if pin:
        confidence = min(confidence + 0.05, 0.95)

    return min(confidence, max_confidence)


def parse_best_buy(text: str) -> ParsedCardData:
    ocr_text = plain_ocr_text(text)
    card_number = choose_card_number(text)
    card_match = re.search(
        r"(?:CARD\s*#?|CARD\s*NUMBER)[^\d]{0,40}((?:\d[\s-]?){16})",
        ocr_text,
        flags=re.IGNORECASE,
    )

    if card_match:
        card_number = digits_only(card_match.group(1))

    pin_match = re.search(r"\bPIN\s*[:#-]?\s*(\d{4})\b", ocr_text, flags=re.IGNORECASE)
    pin = pin_match.group(1) if pin_match else None

    if not pin:
        inline_pin_match = re.search(r"((?:\d[\s-]?){16})\s+(\d{4})\b", ocr_text)
        pin = inline_pin_match.group(2) if inline_pin_match else None

    if not pin:
        pins = [candidate for candidate in find_pin_candidates(text) if len(candidate) == 4]
        pin = pins[0] if pins else None

    confidence = calculate_confidence(
        text=text,
        card_number=card_number,
        pin=pin,
        max_confidence=0.95,
    )

    return ParsedCardData(
        card_number=card_number,
        pin=pin,
        confidence_score=confidence,
        notes=(
            "Best Buy parser. CARD #, barcode card number, and 4-digit PIN "
            "after PIN label or beside card number preferred."
        ),
    )


def parse_nike(text: str) -> ParsedCardData:
    ocr_text = plain_ocr_text(text)
    card_number = choose_card_number(text)
    card_match = re.search(
        r"(?:CARD\s*#?|CARD\s*NUMBER)[^\d]{0,40}((?:\d[\s-]?){12,24})",
        ocr_text,
        flags=re.IGNORECASE,
    )

    if card_match:
        card_number = digits_only(card_match.group(1))

    pin_match = re.search(
        r"(?:PIN|SECURITY\s*CODE|SCRATCH(?:-|\s)?OFF)[^\d]{0,50}(\d{6})",
        ocr_text,
        flags=re.IGNORECASE,
    )
    pin = pin_match.group(1) if pin_match else None

    if not pin:
        pins = [candidate for candidate in find_pin_candidates(text) if len(candidate) == 6]
        pin = pins[0] if pins else None

    confidence = calculate_confidence(
        text=text,
        card_number=card_number,
        pin=pin,
        max_confidence=0.92,
    )

    return ParsedCardData(
        card_number=card_number,
        pin=pin,
        confidence_score=confidence,
        notes="Nike parser. CARD # and 6-digit PIN near scratch-off area preferred.",
    )


def parse_generic(text: str) -> ParsedCardData:
    card_number = choose_card_number(text)
    pins = find_pin_candidates(text)
    pin = pins[0] if pins else None

    confidence = calculate_confidence(
        text=text,
        card_number=card_number,
        pin=pin,
        max_confidence=0.85,
    )

    return ParsedCardData(
        card_number=card_number,
        pin=pin,
        confidence_score=confidence,
        notes="Generic parser. Barcode candidates preferred. Human verification required.",
    )


def parse_card_data(raw_text: str, brand: str | None = None) -> ParsedCardData:
    brand_normalized = (brand or "").strip().lower()

    if "uber" in brand_normalized:
        parsed = parse_prefixed_gift_code(raw_text, brand_name="Uber", prefix="NAAD")
        if parsed:
            return parsed

    if "doordash" in brand_normalized:
        parsed = parse_prefixed_gift_code(raw_text, brand_name="DoorDash", prefix="NAAW")
        if parsed:
            return parsed

    if "best buy" in brand_normalized:
        return parse_best_buy(raw_text)

    if "nike" in brand_normalized:
        return parse_nike(raw_text)

    return parse_generic(raw_text)
