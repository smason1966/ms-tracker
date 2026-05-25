from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ExtractionCandidate:
    candidate_type: str  # card_number or pin
    source: str  # barcode, ocr, heuristic, or template
    value: str
    confidence_score: float
    notes: str


@dataclass
class BrandParsingRules:
    card_number_regex: str | None = None
    pin_regex: str | None = None
    pin_label_keywords: str | None = None
    expected_pin_length: int | None = None
    card_number_source_priority: str | None = None
    pin_spatial_rule: str | None = None
    gift_code_regex: str | None = None
    gift_code_prefixes: str | None = None
    gift_code_expected_length: int | None = None
    gift_code_normalization: str | None = None
    ocr_confusion_map: str | None = None
    ocr_orientation_preference: str | None = None
    credential_type: str | None = None
    ocr_zones: str | None = None


@dataclass(frozen=True)
class BrandOCRProfile:
    key: str
    display_name: str
    credential_type: str
    prefer_barcode_card_number: bool = False
    ignore_numeric_card_candidates: bool = False
    gift_code_prefixes: tuple[str, ...] = ()
    gift_code_patterns: tuple[str, ...] = ()
    gift_code_expected_length: int | None = None
    pin_expected_length: int | None = None
    pin_spatial_rule: str | None = None
    card_number_lengths: tuple[int, ...] = ()
    card_number_prefixes: tuple[str, ...] = ()


@dataclass
class SpatialToken:
    text: str
    left: int
    top: int
    width: int
    height: int
    line_num: int

    @property
    def right(self) -> int:
        return self.left + self.width

    @property
    def center_y(self) -> float:
        return self.top + (self.height / 2)


IGNORED_PIN_VALUES = {"2024", "2025", "2026", "2027", "0525"}
DEFAULT_PIN_KEYWORDS = ["pin", "security code", "scratch", "scratch-off", "boxed"]
BRAND_OCR_PROFILES = {
    "best buy": BrandOCRProfile(
        key="best_buy",
        display_name="Best Buy",
        credential_type="card_number_plus_pin",
        prefer_barcode_card_number=True,
        card_number_lengths=(16,),
        pin_expected_length=4,
        pin_spatial_rule="four_digits_right_of_card_number",
    ),
    "nike": BrandOCRProfile(
        key="nike",
        display_name="Nike",
        credential_type="card_number_plus_optional_pin",
        prefer_barcode_card_number=True,
        card_number_lengths=(19, 16),
        card_number_prefixes=("606010",),
        pin_expected_length=6,
    ),
    "uber": BrandOCRProfile(
        key="uber",
        display_name="Uber",
        credential_type="redemption_code_only",
        ignore_numeric_card_candidates=True,
        gift_code_prefixes=("NAAD",),
        gift_code_patterns=(
            r"\b(NAAD[\s-]*[A-Z0-9]{4}[\s-]*[A-Z0-9]{4}[\s-]*[A-Z0-9]{4})\b"
        ),
        gift_code_expected_length=16,
    ),
    "doordash": BrandOCRProfile(
        key="doordash",
        display_name="DoorDash",
        credential_type="redemption_code_only",
        ignore_numeric_card_candidates=True,
        gift_code_prefixes=("NAAW",),
        gift_code_patterns=(
            r"\b(NAAW[\s-]*[A-Z0-9]{4}[\s-]*[A-Z0-9]{4}[\s-]*[A-Z0-9]{4})\b"
        ),
        gift_code_expected_length=16,
    ),
}
EDGE_CODE_KEYWORDS = [
    "barcode",
    "sku",
    "serial",
    "upc",
    "product code",
    "packaging",
    "terms",
    "www",
    "copyright",
    "valid",
    "receipt",
]


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value)


def normalize_gift_code(value: str, *, uppercase: bool = True) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]", "", value)
    return normalized.upper() if uppercase else normalized


def format_gift_code(value: str) -> str:
    normalized = normalize_gift_code(value)
    if len(normalized) == 16:
        return " ".join(
            normalized[index : index + 4] for index in range(0, 16, 4)
        )
    return normalized


def extract_barcode_values(raw_text: str) -> list[str]:
    if "BARCODE_CANDIDATES:" not in raw_text:
        return []

    values: list[str] = []

    for barcode_section in raw_text.split("BARCODE_CANDIDATES:")[1:]:
        for marker in (
            "\nBARCODE_DETAILS:",
            "\n\nBARCODE_DETAILS:",
            "\nOCR_SPATIAL_TOKENS:",
            "\nENDZONE",
            "\n\nOCR_ZONE_CROPS:",
            "\n\nEXTRACTION_CANDIDATES:",
        ):
            if marker in barcode_section:
                barcode_section = barcode_section.split(marker, 1)[0]

        for line in barcode_section.splitlines():
            value = digits_only(line)

            if len(value) >= 8 and value not in values:
                values.append(value)

    return values


def score_barcode_candidate(
    value: str,
    *,
    profile: BrandOCRProfile | None,
    ocr_number_values: set[str],
) -> tuple[float, str]:
    if len(value) == 16:
        confidence = 0.9
        notes = "16-digit barcode candidate."
    elif 12 <= len(value) <= 24:
        confidence = 0.75
        notes = "Reasonable-length barcode candidate."
    else:
        confidence = 0.35
        notes = "Long barcode candidate; may be POS/purchase barcode."

    if profile and profile.card_number_lengths:
        if len(value) in profile.card_number_lengths:
            confidence = max(confidence, 0.92)
            notes += (
                f" Matches expected {profile.display_name} barcode/card "
                f"length {len(value)}."
            )
        else:
            confidence -= 0.16
            notes += (
                f" Length {len(value)} is not a preferred "
                f"{profile.display_name} credential length."
            )

    if profile and profile.card_number_prefixes:
        if any(value.startswith(prefix) for prefix in profile.card_number_prefixes):
            confidence += 0.05
            notes += (
                f" Matches expected {profile.display_name} credential prefix."
            )
        elif len(value) in profile.card_number_lengths:
            confidence -= 0.05
            notes += (
                f" Missing expected {profile.display_name} credential prefix."
            )

    if profile and profile.prefer_barcode_card_number and len(value) in (
        profile.card_number_lengths or (16,)
    ):
        confidence += 0.02
        notes += (
            f" Detected Credential Type: {profile.credential_type}; "
            "brand profile prefers barcode card number."
        )

    if value in ocr_number_values:
        confidence += 0.04
        notes += " OCR text agrees with decoded barcode."

    return max(0.05, min(confidence, 0.99)), notes


def validate_brand_card_number_candidate(
    value: str,
    *,
    profile: BrandOCRProfile | None,
    source: str,
) -> tuple[bool, str]:
    if not profile:
        return True, ""

    if profile.key == "best_buy":
        if len(value) != 16:
            return (
                False,
                "Rejected by Best Buy profile: card number must be exactly 16 digits; "
                f"{source} produced {len(value)} digits.",
            )
        return True, "Matches Best Buy 16-digit card number rule."

    if profile.key == "nike":
        if profile.card_number_lengths and len(value) not in profile.card_number_lengths:
            return (
                False,
                "Rejected by Nike profile: candidate length does not match expected "
                "redeemable card-number lengths.",
            )
        if profile.card_number_prefixes and not any(
            value.startswith(prefix) for prefix in profile.card_number_prefixes
        ):
            return (
                False,
                "Rejected by Nike profile: candidate does not match expected Nike "
                "redeemable card-number prefix.",
            )
        return True, "Matches Nike redeemable card-number prefix/length rule."

    return True, ""


def add_rejected_card_candidate(
    candidates: list[ExtractionCandidate],
    *,
    source: str,
    value: str,
    reason: str,
) -> None:
    add_candidate(
        candidates,
        ExtractionCandidate(
            candidate_type="rejected",
            source=source,
            value=value,
            confidence_score=0.05,
            notes=reason,
        ),
    )


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


def extract_spatial_tokens(raw_text: str) -> list[SpatialToken]:
    if "OCR_SPATIAL_TOKENS:" not in raw_text:
        return []

    section = raw_text.split("OCR_SPATIAL_TOKENS:", 1)[1]

    for marker in ("\n\nBARCODE_CANDIDATES:", "\n\nEXTRACTION_CANDIDATES:"):
        if marker.strip() in section:
            section = section.split(marker.strip(), 1)[0]

    tokens: list[SpatialToken] = []

    for line in section.splitlines():
        parts = line.strip().split("|")

        if len(parts) != 6:
            continue

        text, left, top, width, height, line_num = parts

        try:
            tokens.append(
                SpatialToken(
                    text=text,
                    left=int(left),
                    top=int(top),
                    width=int(width),
                    height=int(height),
                    line_num=int(line_num),
                )
            )
        except ValueError:
            continue

    return tokens


def extract_zone_sections(raw_text: str) -> list[dict]:
    if "OCR_ZONE_CROPS:" not in raw_text:
        return []

    section = raw_text.split("OCR_ZONE_CROPS:", 1)[1]
    sections: list[dict] = []

    for chunk in section.split("\nZONE|")[1:]:
        header, _, body = chunk.partition("\n")
        zone_text, _, _ = body.partition("\nENDZONE")
        parts = header.split("|")

        if len(parts) < 9:
            continue

        sections.append(
            {
                "zone_name": parts[0],
                "zone_type": parts[1],
                "priority": int(parts[2] or 1),
                "expected_pattern": parts[3] or None,
                "expected_length": int(parts[4]) if parts[4].isdigit() else None,
                "x_pct": parts[5],
                "y_pct": parts[6],
                "width_pct": parts[7],
                "height_pct": parts[8],
                "text": zone_text,
            }
        )

    return sections


def extract_ocr_number_values(raw_text: str) -> list[str]:
    values: list[str] = []

    matches = re.findall(r"(?:\d[\s-]?){8,40}", plain_ocr_text(raw_text))

    for match in matches:
        value = digits_only(match)

        if len(value) >= 8 and value not in values:
            values.append(value)

    return values


def parse_keywords(value: str | None) -> list[str]:
    if not value:
        return []

    return [
        keyword.strip().lower()
        for keyword in re.split(r"[,;\n]", value)
        if keyword.strip()
    ]


def regex_values(pattern: str | None, raw_text: str) -> list[str]:
    if not pattern:
        return []

    values: list[str] = []
    searchable_text = plain_ocr_text(raw_text)

    try:
        matches = re.finditer(pattern, searchable_text, flags=re.IGNORECASE)
    except re.error:
        return []

    for match in matches:
        group_value = match.group(1) if match.groups() else match.group(0)
        value = digits_only(group_value)

        if value and value not in values:
            values.append(value)

    return values


def regex_text_values(pattern: str | None, raw_text: str) -> list[str]:
    if not pattern:
        return []

    values: list[str] = []
    searchable_text = plain_ocr_text(raw_text)

    try:
        matches = re.finditer(pattern, searchable_text, flags=re.IGNORECASE)
    except re.error:
        return []

    for match in matches:
        group_value = match.group(1) if match.groups() else match.group(0)
        value = normalize_gift_code(group_value)

        if value and value not in values:
            values.append(value)

    return values


def prefix_character_pattern(character: str) -> str:
    return {
        "A": "[A4]",
        "D": "[D0O]",
        "W": "[WVU H]",
        "N": "[N]",
    }.get(character, re.escape(character))


def flexible_prefix_pattern(prefix: str) -> str:
    separator = r"[\s.\-_]*"
    return separator.join(prefix_character_pattern(character) for character in prefix)


def flexible_gift_code_pattern(prefix: str) -> str:
    separator = r"[\s.\-_]*"
    return (
        rf"\b({flexible_prefix_pattern(prefix)}{separator}[A-Z0-9]{{4}}"
        rf"{separator}[A-Z0-9]{{4}}{separator}[A-Z0-9]{{4}})\b"
    )


def corrected_prefixed_gift_code_values(
    raw_text: str,
    *,
    prefix: str,
) -> list[str]:
    searchable_text = plain_ocr_text(raw_text).upper()
    pattern = flexible_gift_code_pattern(prefix)
    values: list[str] = []

    for match in re.finditer(pattern, searchable_text, flags=re.IGNORECASE):
        value = normalize_gift_code(match.group(1))
        corrected_prefix = (
            value[: len(prefix)]
            .replace("4", "A")
            .replace("0", "D" if prefix.endswith("D") else "O")
            .replace("O", "D" if prefix.endswith("D") else "O")
            .replace("V", "W")
            .replace("U", "W")
            .replace("H", "W")
        )
        corrected_value = corrected_prefix + value[len(prefix):]

        if corrected_value.startswith(prefix) and corrected_value not in values:
            values.append(corrected_value)

    return values


def embedded_prefixed_gift_code_values(
    raw_text: str,
    *,
    prefix: str,
    expected_length: int | None,
) -> list[str]:
    searchable_text = normalize_gift_code(plain_ocr_text(raw_text))
    expected_length = expected_length or 16
    values: list[str] = []

    for match in re.finditer(re.escape(prefix), searchable_text):
        candidate = searchable_text[match.start() : match.start() + expected_length]

        if len(candidate) != expected_length:
            continue

        if not candidate.startswith(prefix):
            continue

        if candidate not in values:
            values.append(candidate)

    return values


def add_candidate(
    candidates: list[ExtractionCandidate],
    candidate: ExtractionCandidate,
) -> None:
    for index, existing in enumerate(candidates):
        if (
            existing.candidate_type == candidate.candidate_type
            and existing.source == candidate.source
            and existing.value == candidate.value
        ):
            if candidate.confidence_score > existing.confidence_score:
                candidates[index] = candidate
            return

    candidates.append(candidate)


def score_pin_candidate(
    raw_text: str,
    match: re.Match[str],
    value: str,
    keywords: list[str],
    expected_pin_length: int | None,
    brand: str | None,
) -> tuple[float, str]:
    start, end = match.span()
    context_start = max(start - 70, 0)
    context_end = min(end + 70, len(raw_text))
    context = raw_text[context_start:context_end].lower()
    line_start = raw_text.rfind("\n", 0, start) + 1
    line_end = raw_text.find("\n", end)

    if line_end == -1:
        line_end = len(raw_text)

    line_context = raw_text[line_start:line_end].lower()
    effective_keywords = keywords or DEFAULT_PIN_KEYWORDS
    score = 0.25
    reasons: list[str] = []

    if expected_pin_length and len(value) == expected_pin_length:
        score += 0.2
        reasons.append(f"{expected_pin_length}-digit expected PIN length")
    elif 3 <= len(value) <= 8:
        score += 0.05

    if any(keyword in line_context for keyword in effective_keywords):
        score += 0.25
        reasons.append("near PIN/security/scratch label")

    if any(keyword in line_context for keyword in ["scratch", "scratch-off", "box", "boxed"]):
        score += 0.12
        reasons.append("near scratch-off/box wording")

    if "nike" in (brand or "").lower() and len(value) == 6:
        score += 0.12
        reasons.append("Nike 6-digit PIN shape")
    elif "nike" in (brand or "").lower() and len(value) != 6:
        score = 0.05
        reasons.append("rejected Nike PIN candidate because Nike PINs must be 6 digits")

    if "best buy" in (brand or "").lower() and len(value) == 4 and "pin" in line_context:
        score += 0.16
        reasons.append("Best Buy 4-digit PIN shape")

    if re.search(r"\bcard\s*(?:#|number)", line_context):
        score -= 0.32
        reasons.append("deprioritized CARD # line digit group")

    if any(keyword in context for keyword in EDGE_CODE_KEYWORDS):
        score -= 0.18
        reasons.append("deprioritized UPC/packaging/printed code")

    if start > len(raw_text) * 0.82:
        score -= 0.1
        reasons.append("near bottom of OCR text")

    if value in IGNORED_PIN_VALUES:
        score = 0.05
        reasons.append("looks like date/year text")

    score = max(0.05, min(score, 0.92))
    notes = "PIN-like OCR candidate"

    if reasons:
        notes += ": " + "; ".join(reasons)

    return score, notes + "."


def extract_ocr_pin_candidates(
    raw_text: str,
    *,
    brand: str | None,
    rules: BrandParsingRules | None,
) -> list[ExtractionCandidate]:
    candidates: list[ExtractionCandidate] = []
    searchable_text = plain_ocr_text(raw_text)
    expected_pin_length = rules.expected_pin_length if rules else None
    keywords = parse_keywords(rules.pin_label_keywords if rules else None)

    if rules and rules.pin_regex:
        for value in regex_values(rules.pin_regex, raw_text):
            if value in IGNORED_PIN_VALUES:
                continue
            confidence = 0.84
            if expected_pin_length and len(value) == expected_pin_length:
                confidence = 0.9
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="pin",
                    source="ocr",
                    value=format_gift_code(value),
                    confidence_score=confidence,
                    notes="Brand PIN parsing rule candidate.",
                ),
            )

    if "nike" in (brand or "").lower():
        nike_pattern = r"(?:PIN|SECURITY\s*CODE|SCRATCH(?:-|\s)?OFF)[^\d]{0,50}(\d{6})"
        for value in regex_values(nike_pattern, raw_text):
            if value in IGNORED_PIN_VALUES:
                continue
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="pin",
                    source="ocr",
                    value=format_gift_code(value),
                    confidence_score=0.88,
                    notes="Nike PIN candidate near PIN/security/scratch-off wording.",
                ),
            )

    if "best buy" in (brand or "").lower():
        best_buy_pattern = r"\bPIN\s*[:#-]?\s*(\d{4})\b"
        for value in regex_values(best_buy_pattern, raw_text):
            if value in IGNORED_PIN_VALUES:
                continue
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="pin",
                    source="ocr",
                    value=value,
                    confidence_score=0.91,
                    notes="Best Buy 4-digit PIN candidate immediately after PIN label.",
                ),
            )

    pin_pattern = (
        r"\b\d{%d}\b" % expected_pin_length
        if expected_pin_length
        else r"\b\d{3,8}\b"
    )

    for match in re.finditer(pin_pattern, searchable_text):
        value = digits_only(match.group(0))

        if not value or value in IGNORED_PIN_VALUES:
            continue

        confidence, notes = score_pin_candidate(
            raw_text=searchable_text,
            match=match,
            value=value,
            keywords=keywords,
            expected_pin_length=expected_pin_length,
            brand=brand,
        )

        if confidence >= 0.35:
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="pin",
                    source="ocr",
                    value=value,
                    confidence_score=confidence,
                    notes=notes,
                ),
            )

    return sorted(candidates, key=lambda candidate: candidate.confidence_score, reverse=True)


def line_groups(tokens: list[SpatialToken]) -> dict[int, list[SpatialToken]]:
    groups: dict[int, list[SpatialToken]] = {}

    for token in tokens:
        groups.setdefault(token.line_num, []).append(token)

    for line_tokens in groups.values():
        line_tokens.sort(key=lambda token: token.left)

    return groups


def find_best_buy_card_sequence(
    tokens: list[SpatialToken],
    card_number: str | None,
) -> tuple[int, int, int, float] | None:
    best_match: tuple[int, int, int, float] | None = None
    best_confidence = 0.0
    target_card_number = card_number or ""

    for line_num, line_tokens in line_groups(tokens).items():
        digit_tokens = [
            token for token in line_tokens if digits_only(token.text)
        ]

        for start_index in range(len(digit_tokens)):
            combined_digits = ""
            sequence: list[SpatialToken] = []

            for token in digit_tokens[start_index:]:
                token_digits = digits_only(token.text)
                combined_digits += token_digits
                sequence.append(token)

                if len(combined_digits) >= 16:
                    break

            if len(combined_digits) < 16:
                continue

            candidate_card_number = combined_digits[:16]

            if target_card_number and candidate_card_number != target_card_number:
                continue

            right_edge = max(token.right for token in sequence)
            center_y = sum(token.center_y for token in sequence) / len(sequence)
            height = max(token.height for token in sequence)

            line_text = " ".join(token.text for token in line_tokens).lower()
            card_label_bonus = 0.08 if re.search(r"\bcard\s*(?:#|number)", line_text) else 0
            confidence = 0.82 + card_label_bonus

            if not best_match or confidence > best_confidence:
                best_match = (line_num, right_edge, height, center_y)
                best_confidence = confidence

    return best_match


def find_best_buy_spatial_pin_candidates(
    raw_text: str,
    *,
    card_number: str | None,
) -> list[ExtractionCandidate]:
    tokens = extract_spatial_tokens(raw_text)

    if not tokens:
        return []

    card_sequence = find_best_buy_card_sequence(tokens, card_number)

    if not card_sequence:
        return []

    card_line_num, card_right_edge, card_height, card_center_y = card_sequence
    token_left_values = [token.left for token in tokens]
    token_right_values = [token.right for token in tokens]
    min_left = min(token_left_values)
    max_right = max(token_right_values)
    width_span = max(max_right - min_left, 1)
    scored_tokens: list[tuple[SpatialToken, int, float, bool, bool, str]] = []
    candidates: list[ExtractionCandidate] = []

    for token in tokens:
        value = digits_only(token.text)

        if len(value) != 4 or value in IGNORED_PIN_VALUES:
            continue

        vertical_delta = abs(token.center_y - card_center_y)
        is_same_line = token.line_num == card_line_num
        is_to_right = token.left >= card_right_edge
        horizontal_gap = token.left - card_right_edge
        close_vertical = vertical_delta <= max(card_height, token.height) * 1.8
        line_tokens = [
            line_token for line_token in tokens if line_token.line_num == token.line_num
        ]
        line_context = " ".join(line_token.text for line_token in line_tokens).lower()

        if not is_to_right or horizontal_gap < 0 or horizontal_gap > 380:
            continue

        if not (is_same_line or close_vertical):
            continue

        scored_tokens.append(
            (
                token,
                horizontal_gap,
                vertical_delta,
                is_same_line,
                close_vertical,
                line_context,
            )
        )

    if not scored_tokens:
        return []

    nearest_gap = min(
        horizontal_gap
        for _, horizontal_gap, _, is_same_line, _, _ in scored_tokens
        if is_same_line
    ) if any(is_same_line for _, _, _, is_same_line, _, _ in scored_tokens) else min(
        horizontal_gap for _, horizontal_gap, _, _, _, _ in scored_tokens
    )

    for token, horizontal_gap, vertical_delta, is_same_line, close_vertical, line_context in scored_tokens:
        value = digits_only(token.text)
        confidence = 0.52
        notes = "Best Buy PIN candidate near card number"

        if is_same_line and horizontal_gap == nearest_gap:
            confidence = 0.96 if horizontal_gap <= 160 else 0.9
            notes = (
                "Best Buy PIN candidate near card number: 4 digits immediately "
                "after the fourth card-number group."
            )
        elif is_same_line:
            confidence = max(0.62, 0.86 - min(horizontal_gap / 1000, 0.22))
            notes = (
                "Best Buy PIN candidate near card number: 4 digits close to the "
                "card number baseline, but not the nearest right-side token."
            )
        elif close_vertical:
            confidence = max(0.56, 0.76 - min((vertical_delta + horizontal_gap) / 1400, 0.2))
            notes = (
                "Best Buy PIN candidate near card number: 4 digits below-right "
                "of the card number baseline."
            )

        if token.height > token.width * 1.35:
            confidence -= 0.24
            notes += " Deprioritized because token appears vertically oriented."

        edge_margin = width_span * 0.07
        if token.left <= min_left + edge_margin or token.right >= max_right - edge_margin:
            confidence -= 0.18
            notes += " Deprioritized because token is near outer card edge."

        if any(keyword in line_context for keyword in EDGE_CODE_KEYWORDS):
            confidence -= 0.22
            notes += " Deprioritized because token is near barcode/product/edge text."

        if value in IGNORED_PIN_VALUES:
            confidence = 0.05
            notes += " Deprioritized because token looks like a date code."

        confidence = max(0.05, min(confidence, 0.97))

        if confidence < 0.35:
            continue

        add_candidate(
            candidates,
            ExtractionCandidate(
                candidate_type="pin",
                source="heuristic",
                value=value,
                confidence_score=confidence,
                notes=notes + ".",
            ),
        )

    return sorted(candidates, key=lambda candidate: candidate.confidence_score, reverse=True)


def find_best_buy_inline_pin_candidates(raw_text: str) -> list[ExtractionCandidate]:
    candidates: list[ExtractionCandidate] = []
    text = plain_ocr_text(raw_text)

    pattern = r"((?:\d[\s-]?){16})\s+(\d{4})\b"

    for match in re.finditer(pattern, text):
        value = digits_only(match.group(2))

        if value in IGNORED_PIN_VALUES:
            continue

        add_candidate(
            candidates,
            ExtractionCandidate(
                candidate_type="pin",
                source="heuristic",
                value=value,
                confidence_score=0.87,
                notes=(
                    "Best Buy PIN candidate near card number: 4 digits after "
                    "the grouped 16-digit card number on the same OCR line."
                ),
            ),
        )

    return sorted(candidates, key=lambda candidate: candidate.confidence_score, reverse=True)


def find_best_buy_label_pin_candidates(raw_text: str) -> list[ExtractionCandidate]:
    candidates: list[ExtractionCandidate] = []
    text = plain_ocr_text(raw_text)
    pattern = r"\bPIN\s*[:#-]?\s*(\d{4})\b"

    for match in re.finditer(pattern, text, flags=re.IGNORECASE):
        value = digits_only(match.group(1))

        if value in IGNORED_PIN_VALUES:
            continue

        add_candidate(
            candidates,
            ExtractionCandidate(
                candidate_type="pin",
                source="ocr",
                value=value,
                confidence_score=0.94,
                notes="Best Buy PIN candidate immediately after PIN label.",
            ),
        )

    return sorted(candidates, key=lambda candidate: candidate.confidence_score, reverse=True)


def authoritative_card_number(candidates: list[ExtractionCandidate]) -> str | None:
    barcode_candidates = [
        candidate for candidate in candidates
        if candidate.candidate_type == "card_number"
        and candidate.source == "barcode"
        and len(candidate.value) == 16
    ]

    if barcode_candidates:
        return barcode_candidates[0].value

    sixteen_digit_candidates = [
        candidate for candidate in candidates
        if candidate.candidate_type == "card_number"
        and len(candidate.value) == 16
    ]

    if sixteen_digit_candidates:
        return max(
            sixteen_digit_candidates,
            key=lambda candidate: candidate.confidence_score,
        ).value

    return None


def parse_rule_prefixes(value: str | None) -> list[str]:
    if not value:
        return []

    return [
        normalize_gift_code(prefix)
        for prefix in re.split(r"[,;\n]", value)
        if normalize_gift_code(prefix)
    ]


def brand_profile_for(brand: str | None) -> BrandOCRProfile | None:
    normalized_brand = (brand or "").strip().lower()

    for key, profile in BRAND_OCR_PROFILES.items():
        if key in normalized_brand:
            return profile

    return None


def build_prefix_gift_code_pattern(prefix: str) -> str:
    separator = r"[\s.\-_]*"
    escaped_prefix = separator.join(re.escape(character) for character in prefix)
    return (
        rf"\b({escaped_prefix}{separator}[A-Z0-9]{{4}}"
        rf"{separator}[A-Z0-9]{{4}}{separator}[A-Z0-9]{{4}})\b"
    )


def extract_gift_code_candidates(
    raw_text: str,
    *,
    brand: str | None,
    rules: BrandParsingRules | None,
) -> list[ExtractionCandidate]:
    candidates: list[ExtractionCandidate] = []
    profile = brand_profile_for(brand)
    display_name = profile.display_name if profile else (brand or "Brand")
    prefixes = parse_rule_prefixes(rules.gift_code_prefixes if rules else None)
    expected_length = rules.gift_code_expected_length if rules else None
    patterns: list[str] = []

    if rules and rules.gift_code_regex:
        patterns.extend(
            pattern.strip()
            for pattern in re.split(r"\n+", rules.gift_code_regex)
            if pattern.strip()
        )

    if profile:
        prefixes.extend(
            prefix for prefix in profile.gift_code_prefixes if prefix not in prefixes
        )
        expected_length = expected_length or profile.gift_code_expected_length
        patterns.extend(profile.gift_code_patterns)

    patterns.extend(build_prefix_gift_code_pattern(prefix) for prefix in prefixes)

    for pattern in patterns:
        for value in regex_text_values(pattern, raw_text):
            if prefixes and not any(value.startswith(prefix) for prefix in prefixes):
                continue

            confidence = 0.84
            reasons = ["OCR pattern match"]

            if prefixes and any(value.startswith(prefix) for prefix in prefixes):
                confidence += 0.08
                reasons.append("expected prefix")

            if expected_length and len(value) == expected_length:
                confidence += 0.05
                reasons.append("expected length")

            if profile:
                confidence += 0.03
                reasons.append(f"Detected {display_name} gift code format")

            confidence = min(confidence, 0.98)

            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="card_number",
                    source="template",
                    value=format_gift_code(value),
                    confidence_score=confidence,
                    notes=(
                        f"Detected {display_name} gift code format. "
                        f"OCR confidence: pattern-based; pattern confidence: "
                        f"{confidence:.0%}; combined confidence: {confidence:.0%}. "
                        f"Detected Credential Type: "
                        f"{profile.credential_type if profile else 'Redemption code'}. "
                        + "; ".join(reasons)
                        + "."
                    ),
                ),
            )

    for prefix in prefixes:
        for value in corrected_prefixed_gift_code_values(raw_text, prefix=prefix):
            formatted_value = format_gift_code(value)
            if any(candidate.value == formatted_value for candidate in candidates):
                continue

            confidence = 0.68
            if expected_length and len(value) == expected_length:
                confidence += 0.04

            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="card_number",
                    source="template",
                    value=formatted_value,
                    confidence_score=confidence,
                    notes=(
                        f"Possible {display_name} redemption code from OCR "
                        "prefix correction. Low confidence; requires user "
                        "confirmation."
                    ),
                ),
            )

        for value in embedded_prefixed_gift_code_values(
            raw_text,
            prefix=prefix,
            expected_length=expected_length,
        ):
            formatted_value = format_gift_code(value)
            if any(candidate.value == formatted_value for candidate in candidates):
                continue

            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="card_number",
                    source="template",
                    value=formatted_value,
                    confidence_score=0.62,
                    notes=(
                        f"Possible {display_name} redemption code from embedded "
                        f"{prefix} prefix. Stripped surrounding OCR noise and "
                        "kept the expected code length. Low confidence; requires "
                        "user confirmation."
                    ),
                ),
            )

    return sorted(candidates, key=lambda candidate: candidate.confidence_score, reverse=True)


def extract_zone_candidates(
    raw_text: str,
    *,
    brand: str | None,
    rules: BrandParsingRules | None,
) -> list[ExtractionCandidate]:
    candidates: list[ExtractionCandidate] = []

    for zone in extract_zone_sections(raw_text):
        zone_type = zone["zone_type"]
        if zone_type in {"ignore", "card_boundary"}:
            continue

        zone_text = zone["text"]
        zone_name = zone["zone_name"]
        priority = max(zone["priority"], 1)
        boost = max(0.04, min(0.14, 0.16 - (priority * 0.02)))
        notes_suffix = (
            f" Zone OCR source: {zone_name} ({zone_type}) "
            f"at {zone['x_pct']}%,{zone['y_pct']}% "
            f"{zone['width_pct']}x{zone['height_pct']}%."
        )

        if zone_type == "redemption_code":
            for candidate in extract_gift_code_candidates(
                zone_text,
                brand=brand,
                rules=rules,
            ):
                add_candidate(
                    candidates,
                    ExtractionCandidate(
                        candidate_type="card_number",
                        source="zone",
                        value=candidate.value,
                        confidence_score=min(candidate.confidence_score + boost, 0.99),
                        notes=(candidate.notes + notes_suffix),
                    ),
                )

        elif zone_type == "pin":
            zone_rules = BrandParsingRules(
                pin_regex=zone["expected_pattern"] or (rules.pin_regex if rules else None),
                expected_pin_length=zone["expected_length"] or (rules.expected_pin_length if rules else None),
                pin_label_keywords=rules.pin_label_keywords if rules else None,
            )

            for candidate in extract_ocr_pin_candidates(
                zone_text,
                brand=brand,
                rules=zone_rules,
            ):
                add_candidate(
                    candidates,
                    ExtractionCandidate(
                        candidate_type="pin",
                        source="zone",
                        value=candidate.value,
                        confidence_score=min(candidate.confidence_score + boost, 0.99),
                        notes=(candidate.notes + notes_suffix),
                    ),
                )

        elif zone_type in {"card_number", "barcode"}:
            values: list[str] = []

            values.extend(extract_barcode_values(zone_text))
            if zone["expected_pattern"]:
                values.extend(regex_values(zone["expected_pattern"], zone_text))
            else:
                values.extend(extract_ocr_number_values(zone_text))

            for value in values:
                expected_length = zone["expected_length"]
                if not value:
                    continue

                if (
                    "nike" in (brand or "").lower()
                    and zone_type == "barcode"
                    and "activation" in zone_name.lower()
                ):
                    add_candidate(
                        candidates,
                        ExtractionCandidate(
                            candidate_type="rejected",
                            source="zone",
                            value=value,
                            confidence_score=0.05,
                            notes=(
                                f"Nike activation/retail barcode from {zone_name}; "
                                "auxiliary POS data, not selected as redeemable credential."
                                + notes_suffix
                            ),
                        ),
                    )
                    continue

                confidence = 0.82

                if expected_length and len(value) == expected_length:
                    confidence = 0.92
                elif 12 <= len(value) <= 24:
                    confidence = 0.86

                profile = brand_profile_for(brand)
                is_valid, validation_note = validate_brand_card_number_candidate(
                    value,
                    profile=profile,
                    source=f"zone {zone_name}",
                )

                if not is_valid:
                    add_rejected_card_candidate(
                        candidates,
                        source="zone",
                        value=value,
                        reason=validation_note + notes_suffix,
                    )
                    continue

                if (
                    "nike" in (brand or "").lower()
                    and zone_type == "barcode"
                    and "redeem" in zone_name.lower()
                ):
                    confidence = max(confidence, 0.95)

                add_candidate(
                    candidates,
                    ExtractionCandidate(
                        candidate_type="card_number",
                        source="zone",
                        value=value,
                        confidence_score=min(confidence + boost, 0.99),
                        notes=(
                            f"Zone OCR {zone_type} candidate from {zone_name}."
                            + (f" {validation_note}" if validation_note else "")
                            + (
                                " Nike redeem barcode zone preferred for card "
                                "number extraction."
                                if "nike" in (brand or "").lower()
                                and zone_type == "barcode"
                                and "redeem" in zone_name.lower()
                                else ""
                            )
                            + notes_suffix
                        ),
                    ),
                )

    return sorted(candidates, key=lambda candidate: candidate.confidence_score, reverse=True)


def build_extraction_candidates(
    raw_text: str,
    *,
    brand: str | None = None,
    rules: BrandParsingRules | None = None,
) -> list[ExtractionCandidate]:
    candidates: list[ExtractionCandidate] = []
    profile = brand_profile_for(brand)
    use_redemption_profile = bool(profile and profile.ignore_numeric_card_candidates)
    ocr_number_values = set(extract_ocr_number_values(raw_text))

    for candidate in extract_zone_candidates(raw_text, brand=brand, rules=rules):
        add_candidate(candidates, candidate)

    for candidate in extract_gift_code_candidates(raw_text, brand=brand, rules=rules):
        add_candidate(candidates, candidate)

    if not use_redemption_profile:
        for value in extract_barcode_values(raw_text):
            is_valid, validation_note = validate_brand_card_number_candidate(
                value,
                profile=profile,
                source="barcode",
            )
            if not is_valid:
                add_rejected_card_candidate(
                    candidates,
                    source="barcode",
                    value=value,
                    reason=validation_note,
                )
                continue

            confidence, notes = score_barcode_candidate(
                value,
                profile=profile,
                ocr_number_values=ocr_number_values,
            )

            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="card_number",
                    source="barcode",
                    value=value,
                    confidence_score=confidence,
                    notes=notes + (f" {validation_note}" if validation_note else ""),
                )
            )
    elif extract_barcode_values(raw_text):
        for value in extract_barcode_values(raw_text):
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="rejected",
                    source="barcode",
                    value=value,
                    confidence_score=0.05,
                    notes=(
                        f"Rejected by {profile.display_name} profile: barcode/internal "
                        "tracking values are not redeemable credentials."
                    ),
                ),
            )

    if rules and rules.card_number_regex:
        for value in regex_values(rules.card_number_regex, raw_text):
            if len(value) < 8:
                continue
            is_valid, validation_note = validate_brand_card_number_candidate(
                value,
                profile=profile,
                source="brand regex",
            )
            if not is_valid:
                add_rejected_card_candidate(
                    candidates,
                    source="ocr",
                    value=value,
                    reason=validation_note,
                )
                continue
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="card_number",
                    source="ocr",
                    value=value,
                    confidence_score=0.82 if 12 <= len(value) <= 24 else 0.55,
                    notes=(
                        "Brand card number parsing rule candidate."
                        + (f" {validation_note}" if validation_note else "")
                    ),
                ),
            )

    if "nike" in (brand or "").lower():
        nike_card_pattern = (
            r"(?:CARD\s*#?|CARD\s*NUMBER|ACCOUNT\s*#?)[^\d]{0,60}((?:\d[\s-]?){12,24})"
        )
        for value in regex_values(nike_card_pattern, raw_text):
            is_valid, validation_note = validate_brand_card_number_candidate(
                value,
                profile=profile,
                source="Nike printed OCR",
            )
            if not is_valid:
                add_rejected_card_candidate(
                    candidates,
                    source="ocr",
                    value=value,
                    reason=validation_note,
                )
                continue
            confidence = 0.84
            notes = "Nike printed card number OCR candidate."
            if profile and len(value) in profile.card_number_lengths:
                confidence = 0.9
                notes += " Matches expected Nike card number length."
            if profile and any(value.startswith(prefix) for prefix in profile.card_number_prefixes):
                confidence += 0.04
                notes += " Matches expected Nike card number prefix."
            if validation_note:
                notes += f" {validation_note}"
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="card_number",
                    source="ocr",
                    value=value,
                    confidence_score=min(confidence, 0.97),
                    notes=notes,
                ),
            )

    if "best buy" in (brand or "").lower():
        best_buy_card_pattern = (
            r"(?:CARD\s*#?|CARD\s*NUMBER)[^\d]{0,40}((?:\d[\s-]?){16})"
        )
        for value in regex_values(best_buy_card_pattern, raw_text):
            is_valid, validation_note = validate_brand_card_number_candidate(
                value,
                profile=profile,
                source="Best Buy CARD # OCR",
            )
            if not is_valid:
                add_rejected_card_candidate(
                    candidates,
                    source="ocr",
                    value=value,
                    reason=validation_note,
                )
                continue
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="card_number",
                    source="ocr",
                    value=value,
                    confidence_score=0.85,
                    notes=(
                        "Best Buy CARD # OCR candidate."
                        + (f" {validation_note}" if validation_note else "")
                    ),
                ),
            )

    if not use_redemption_profile:
        for value in extract_ocr_number_values(raw_text):
            is_valid, validation_note = validate_brand_card_number_candidate(
                value,
                profile=profile,
                source="OCR",
            )
            if not is_valid:
                add_rejected_card_candidate(
                    candidates,
                    source="ocr",
                    value=value,
                    reason=validation_note,
                )
                continue

            if len(value) == 16:
                confidence = 0.65
                notes = "16-digit OCR candidate."
            elif 12 <= len(value) <= 24:
                confidence = 0.45
                notes = "Reasonable-length OCR candidate."
            else:
                confidence = 0.2
                notes = "Long OCR candidate; may be unrelated text."

            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="card_number",
                    source="ocr",
                    value=value,
                    confidence_score=confidence,
                    notes=notes + (f" {validation_note}" if validation_note else ""),
                )
            )
    elif extract_ocr_number_values(raw_text):
        for value in extract_ocr_number_values(raw_text):
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="rejected",
                    source="ocr",
                    value=value,
                    confidence_score=0.05,
                    notes=(
                        f"Rejected by {profile.display_name} profile: numeric OCR "
                        "values are not the primary redemption code."
                    ),
                ),
            )

    if "best buy" in (brand or "").lower():
        card_number = authoritative_card_number(candidates)

        for candidate in find_best_buy_label_pin_candidates(raw_text):
            add_candidate(candidates, candidate)

        for candidate in find_best_buy_spatial_pin_candidates(
            raw_text,
            card_number=card_number,
        ):
            add_candidate(candidates, candidate)

        for candidate in find_best_buy_inline_pin_candidates(raw_text):
            add_candidate(candidates, candidate)

    if use_redemption_profile:
        for candidate in extract_ocr_pin_candidates(raw_text, brand=brand, rules=rules):
            add_candidate(
                candidates,
                ExtractionCandidate(
                    candidate_type="rejected",
                    source=candidate.source,
                    value=candidate.value,
                    confidence_score=0.05,
                    notes=(
                        f"Rejected by {profile.display_name} profile: this brand "
                        "uses a redemption code only and does not have a separate PIN."
                    ),
                ),
            )
    elif "best buy" not in (brand or "").lower():
        for candidate in extract_ocr_pin_candidates(raw_text, brand=brand, rules=rules):
            add_candidate(candidates, candidate)

    return sorted(candidates, key=lambda candidate: candidate.confidence_score, reverse=True)
