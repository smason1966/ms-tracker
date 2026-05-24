from __future__ import annotations

import json
import time
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card_brand import CardBrand
from app.models.card_image import CardImage
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_candidate import ExtractionCandidate
from app.models.extraction_profile_metric import ExtractionProfileMetric
from app.models.gift_card import GiftCard
from app.services.barcode import decode_barcode_details
from app.services.card_parser import parse_card_data
from app.services.extraction_candidates import (
    BrandParsingRules,
    ExtractionCandidate as BuiltExtractionCandidate,
    brand_profile_for,
    build_extraction_candidates,
    validate_brand_card_number_candidate,
)
from app.services.image_preprocessing import (
    preprocess_card_image_with_rotation,
)
from app.services.ocr import (
    OCRToken,
    extract_region_ocr_result,
    extract_text_and_tokens,
)

router = APIRouter(prefix="/card-images", tags=["card-images"])

UPLOAD_DIR = Path("uploads/card-images")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

OCR_STATE_UPLOADING = "uploading"
OCR_STATE_PREPROCESSING = "preprocessing"
OCR_STATE_CANONICAL_READY = "canonical_ready"
OCR_STATE_ZONES_READY = "zones_ready"
OCR_STATE_OCR_READY = "ocr_ready"


class OCRZoneTestPayload(BaseModel):
    zone_name: str = "test_zone"
    zone_type: str
    x_pct: float
    y_pct: float
    width_pct: float
    height_pct: float
    expected_pattern: str | None = None
    expected_length: int | None = None
    image_source: str = "displayed"
    rotation_degrees: int = 0


def get_brand_rules(db: Session, gift_card: GiftCard | None) -> BrandParsingRules | None:
    if not gift_card:
        return None

    card_brand = (
        db.query(CardBrand)
        .filter(CardBrand.name.ilike(gift_card.brand))
        .first()
    )

    if not card_brand:
        return None

    return BrandParsingRules(
        card_number_regex=card_brand.card_number_regex,
        pin_regex=card_brand.pin_regex,
        pin_label_keywords=card_brand.pin_label_keywords,
        expected_pin_length=card_brand.expected_pin_length,
        card_number_source_priority=card_brand.card_number_source_priority,
        pin_spatial_rule=card_brand.pin_spatial_rule,
        gift_code_regex=card_brand.gift_code_regex,
        gift_code_prefixes=card_brand.gift_code_prefixes,
        gift_code_expected_length=card_brand.gift_code_expected_length,
        gift_code_normalization=card_brand.gift_code_normalization,
        ocr_confusion_map=card_brand.ocr_confusion_map,
        ocr_orientation_preference=card_brand.ocr_orientation_preference,
        credential_type=card_brand.credential_type,
        ocr_zones=card_brand.ocr_zones,
    )


def parse_ocr_layouts(rules: BrandParsingRules | None) -> list[dict]:
    if not rules or not rules.ocr_zones:
        return []

    try:
        value = json.loads(rules.ocr_zones)
    except json.JSONDecodeError:
        return []

    raw_layouts: list[dict]

    if isinstance(value, list):
        raw_layouts = [{"layout_name": "default", "zones": value, "active": True}]
    elif isinstance(value, dict):
        layouts = (
            value.get("layouts")
            or value.get("layout_variants")
            or value.get("variants")
        )
        if isinstance(layouts, list):
            raw_layouts = [
                layout
                for layout in layouts
                if isinstance(layout, dict) and layout.get("active") is not False
            ]
        else:
            raw_layouts = [
                {
                    "layout_name": value.get("layout_name")
                    or value.get("name")
                    or "default",
                    "zones": value.get("zones", []),
                    "active": True,
                }
            ]
    else:
        return []

    parsed_layouts: list[dict] = []

    for layout_index, layout in enumerate(raw_layouts, start=1):
        value = layout.get("zones", [])
        if not isinstance(value, list):
            continue

        zones: list[dict] = []

        for zone in value:
            if not isinstance(zone, dict):
                continue

            zone_type = str(zone.get("zone_type") or "").strip().lower()
            if zone_type not in {"card_number", "pin", "redemption_code", "barcode", "ignore", "card_boundary"}:
                continue

            try:
                x_pct = float(zone.get("x_pct"))
                y_pct = float(zone.get("y_pct"))
                width_pct = float(zone.get("width_pct"))
                height_pct = float(zone.get("height_pct"))
            except (TypeError, ValueError):
                continue

            if width_pct <= 0 or height_pct <= 0:
                continue

            zones.append(
                {
                    "zone_name": str(zone.get("zone_name") or zone_type),
                    "zone_type": zone_type,
                    "x_pct": max(0, min(x_pct, 100)),
                    "y_pct": max(0, min(y_pct, 100)),
                    "width_pct": max(0, min(width_pct, 100)),
                    "height_pct": max(0, min(height_pct, 100)),
                    "priority": int(zone.get("priority") or 1),
                    "expected_pattern": str(zone.get("expected_pattern") or ""),
                    "expected_length": zone.get("expected_length"),
                    "notes": str(zone.get("notes") or ""),
                }
            )

        if not zones:
            continue

        parsed_layouts.append(
            {
                "layout_name": str(
                    layout.get("layout_name")
                    or layout.get("name")
                    or f"layout_{layout_index}"
                ),
                "zones": sorted(zones, key=lambda item: item["priority"]),
            }
        )

    return parsed_layouts


def parse_ocr_zones(rules: BrandParsingRules | None) -> list[dict]:
    layouts = parse_ocr_layouts(rules)
    return layouts[0]["zones"] if layouts else []


def parse_ocr_template_metadata(rules: BrandParsingRules | None) -> dict:
    if not rules or not rules.ocr_zones:
        return {}

    try:
        value = json.loads(rules.ocr_zones)
    except json.JSONDecodeError:
        return {}

    if not isinstance(value, dict):
        return {}

    processed_dimensions = value.get("processed_image_dimensions")
    if not isinstance(processed_dimensions, dict):
        processed_dimensions = {}

    return {
        "coordinate_space": value.get("coordinate_space"),
        "trained_orientation": value.get("trained_orientation")
        or value.get("rotation_degrees"),
        "applied_rotation": value.get("applied_rotation"),
        "canonical_width": value.get("canonical_width")
        or processed_dimensions.get("width"),
        "canonical_height": value.get("canonical_height")
        or processed_dimensions.get("height"),
    }


def safe_decode_barcode_details(image_path: str, rotation_degrees: int) -> list[dict]:
    try:
        return decode_barcode_details(image_path, rotation_degrees=rotation_degrees)
    except Exception:
        return []


def format_barcode_details(details: list[dict]) -> str:
    if not details:
        return ""

    lines = ["\n\nBARCODE_DETAILS:"]
    for detail in details:
        lines.append(
            "|".join(
                [
                    str(detail.get("decoded_value") or ""),
                    str(detail.get("barcode_length") or ""),
                    str(detail.get("barcode_type") or ""),
                    str(detail.get("x") or 0),
                    str(detail.get("y") or 0),
                    str(detail.get("width") or 0),
                    str(detail.get("height") or 0),
                ]
            )
        )

    return "\n".join(lines)


def format_spatial_tokens(tokens: list[OCRToken]) -> str:
    if not tokens:
        return ""

    lines = ["\n\nOCR_SPATIAL_TOKENS:"]

    for token in tokens:
        safe_text = token.text.replace("|", " ").replace("\n", " ").strip()
        lines.append(
            "|".join(
                [
                    safe_text,
                    str(token.left),
                    str(token.top),
                    str(token.width),
                    str(token.height),
                    str(token.line_num),
                ]
            )
        )

    return "\n".join(lines)


def build_combined_ocr_text(
    *,
    raw_text: str,
    spatial_tokens: list[OCRToken],
    barcode_values: list[str],
    rotation_degrees: int,
) -> str:
    combined_text = raw_text
    combined_text += f"\n\nOCR_ROTATION_DEGREES: {rotation_degrees}"
    combined_text += format_spatial_tokens(spatial_tokens)

    if barcode_values:
        combined_text += "\n\nBARCODE_CANDIDATES:\n"
        combined_text += "\n".join(barcode_values)

    return combined_text


def append_zone_ocr_text(
    *,
    combined_text: str,
    image_path: str,
    zones: list[dict],
    layout_name: str | None,
    rotation_degrees: int,
) -> str:
    if not zones:
        return combined_text

    combined_text += "\n\nOCR_ZONE_CROPS:"
    if layout_name:
        combined_text += f"\nOCR_ZONE_LAYOUT: {layout_name}"

    for zone in zones:
        if zone["zone_type"] in {"card_boundary", "ignore"}:
            continue

        try:
            region_result = extract_region_ocr_result(
                image_path,
                x_pct=zone["x_pct"],
                y_pct=zone["y_pct"],
                width_pct=zone["width_pct"],
                height_pct=zone["height_pct"],
                rotation_degrees=rotation_degrees,
                horizontal_padding_pct=0.10,
                vertical_padding_pct=0.20,
            )
            zone_text = region_result.text
            zone_tokens = region_result.tokens
            zone_barcode_details: list[dict] = []
            if region_result.debug_image_paths:
                zone_barcode_details = safe_decode_barcode_details(
                    region_result.debug_image_paths[-1],
                    rotation_degrees=0,
                )
        except Exception as exc:
            zone_text = f"OCR_ZONE_ERROR: {exc}"
            zone_tokens = []
            zone_barcode_details = []

        combined_text += (
            "\nZONE|"
            f"{zone['zone_name']}|{zone['zone_type']}|{zone['priority']}|"
            f"{zone['expected_pattern']}|{zone['expected_length'] or ''}|"
            f"{zone['x_pct']}|{zone['y_pct']}|{zone['width_pct']}|{zone['height_pct']}"
            "\n"
        )
        combined_text += zone_text.strip() or "NO_TEXT"
        combined_text += format_spatial_tokens(zone_tokens)
        if zone_barcode_details:
            combined_text += "\nBARCODE_CANDIDATES:\n"
            combined_text += "\n".join(
                str(detail.get("decoded_value") or "")
                for detail in zone_barcode_details
                if detail.get("decoded_value")
            )
            combined_text += format_barcode_details(zone_barcode_details)
        combined_text += "\nENDZONE"

    return combined_text


def extraction_score(
    *,
    brand: str | None,
    parsed_confidence: float,
    parsed_card_number: str | None,
    parsed_pin: str | None,
    candidates: list,
    barcode_values: list[str],
) -> float:
    profile = brand_profile_for(brand)
    best_card_candidate = max(
        (
            candidate.confidence_score
            for candidate in candidates
            if candidate.candidate_type == "card_number"
            and validate_brand_card_number_candidate(
                candidate.value,
                profile=profile,
                source=candidate.source,
            )[0]
        ),
        default=0,
    )
    best_pin_candidate = max(
        (
            candidate.confidence_score
            for candidate in candidates
            if candidate.candidate_type == "pin"
        ),
        default=0,
    )
    has_authoritative_barcode = any(
        validate_brand_card_number_candidate(
            "".join(character for character in value if character.isdigit()),
            profile=profile,
            source="barcode",
        )[0]
        for value in barcode_values
    )

    score = parsed_confidence
    score += best_card_candidate
    score += best_pin_candidate

    if parsed_card_number:
        score += 0.75

    if parsed_pin:
        score += 0.45

    if has_authoritative_barcode:
        score += 0.35

    return score


def best_candidate(
    candidates: list[BuiltExtractionCandidate],
    candidate_type: str,
) -> BuiltExtractionCandidate | None:
    matching_candidates = [
        candidate
        for candidate in candidates
        if candidate.candidate_type == candidate_type
    ]

    if not matching_candidates:
        return None

    return max(matching_candidates, key=lambda candidate: candidate.confidence_score)


def ocr_pass_parts(pass_name: str) -> tuple[str, str]:
    parts = pass_name.split(":")
    variant = parts[1] if len(parts) >= 3 else pass_name
    mode = parts[2] if len(parts) >= 3 else ""
    return variant, mode


def aggregate_zone_pass_candidates(
    pass_candidate_rows: list[tuple[dict, BuiltExtractionCandidate]],
    *,
    preferred_candidate_type: str | None,
) -> list[BuiltExtractionCandidate]:
    grouped: dict[tuple[str, str], dict] = {}

    for pass_result, candidate in pass_candidate_rows:
        key = (candidate.candidate_type, candidate.value)
        variant, mode = ocr_pass_parts(str(pass_result.get("pass_name") or ""))
        group = grouped.setdefault(
            key,
            {
                "candidate_type": candidate.candidate_type,
                "value": candidate.value,
                "source": candidate.source,
                "max_confidence": candidate.confidence_score,
                "notes": candidate.notes,
                "passes": set(),
                "variants": set(),
                "modes": set(),
            },
        )
        group["max_confidence"] = max(
            group["max_confidence"],
            candidate.confidence_score,
        )
        group["passes"].add(str(pass_result.get("pass_name") or "unknown"))
        group["variants"].add(variant)
        group["modes"].add(mode)

    suffix_best_counts: dict[tuple[str, str], int] = {}
    for group in grouped.values():
        if group["candidate_type"] != "pin" or len(group["value"]) < 2:
            continue
        suffix_key = (group["candidate_type"], group["value"][1:])
        suffix_best_counts[suffix_key] = max(
            suffix_best_counts.get(suffix_key, 0),
            len(group["passes"]),
        )

    aggregated_candidates: list[BuiltExtractionCandidate] = []
    for group in grouped.values():
        consensus_count = len(group["passes"])
        modes = group["modes"]
        variants = group["variants"]
        consensus_bonus = min(0.34, max(0, consensus_count - 1) * 0.075)
        mode_bonus = 0.0
        if "raw_line" in modes:
            mode_bonus += 0.08
        if "single_line" in modes:
            mode_bonus += 0.07
        if modes and modes <= {"block"}:
            mode_bonus -= 0.04

        variant_bonus = 0.0
        if any(str(variant).startswith("original") for variant in variants):
            variant_bonus += 0.04
        if "sharpened" in variants:
            variant_bonus += 0.03
        if "grayscale_contrast" in variants:
            variant_bonus += 0.025
        if "saturation" in variants or "red_channel" in variants:
            variant_bonus += 0.025

        confusion_penalty = 0.0
        if group["candidate_type"] == "pin" and len(group["value"]) >= 2:
            suffix_key = (group["candidate_type"], group["value"][1:])
            best_suffix_count = suffix_best_counts.get(suffix_key, consensus_count)
            if best_suffix_count > consensus_count:
                confusion_penalty = min(
                    0.18,
                    (best_suffix_count - consensus_count) * 0.06,
                )

        type_bonus = (
            0.03
            if preferred_candidate_type
            and group["candidate_type"] == preferred_candidate_type
            else 0.0
        )
        aggregate_confidence = max(
            0.01,
            min(
                0.99,
                group["max_confidence"]
                + consensus_bonus
                + mode_bonus
                + variant_bonus
                + type_bonus
                - confusion_penalty,
            ),
        )
        notes = (
            f"{group['notes']} Consensus across {consensus_count} OCR pass"
            f"{'' if consensus_count == 1 else 'es'}; modes="
            f"{', '.join(sorted(mode for mode in modes if mode)) or 'unknown'}; "
            f"variants={', '.join(sorted(variants)) or 'unknown'}."
        )
        if confusion_penalty:
            notes += (
                " Penalized as a likely first-digit OCR confusion because a "
                "same-suffix candidate had stronger consensus."
            )

        aggregated_candidates.append(
            BuiltExtractionCandidate(
                candidate_type=group["candidate_type"],
                source=f"{group['source']}_consensus",
                value=group["value"],
                confidence_score=aggregate_confidence,
                notes=notes,
            )
        )

    return sorted(
        aggregated_candidates,
        key=lambda candidate: (
            1
            if preferred_candidate_type
            and candidate.candidate_type == preferred_candidate_type
            else 0,
            candidate.confidence_score,
        ),
        reverse=True,
    )


def selected_credential_values(
    *,
    brand: str | None,
    parsed_card_number: str | None,
    parsed_pin: str | None,
    parsed_confidence: float,
    candidates: list[BuiltExtractionCandidate],
) -> tuple[str | None, str | None, float, str]:
    profile = brand_profile_for(brand)
    valid_card_candidates = [
        candidate
        for candidate in candidates
        if candidate.candidate_type == "card_number"
        and validate_brand_card_number_candidate(
            candidate.value,
            profile=profile,
            source=candidate.source,
        )[0]
    ]
    valid_barcode_candidates = [
        candidate for candidate in valid_card_candidates if candidate.source == "barcode"
    ]
    card_candidate = (
        max(valid_barcode_candidates, key=lambda candidate: candidate.confidence_score)
        if profile and profile.prefer_barcode_card_number and valid_barcode_candidates
        else (
            max(valid_card_candidates, key=lambda candidate: candidate.confidence_score)
            if valid_card_candidates
            else None
        )
    )
    pin_candidate = best_candidate(candidates, "pin")
    selected_card_number = parsed_card_number
    selected_pin = parsed_pin
    confidence = parsed_confidence
    notes: list[str] = []

    if selected_card_number:
        is_parsed_valid, invalid_reason = validate_brand_card_number_candidate(
            selected_card_number,
            profile=profile,
            source="parser",
        )
        if not is_parsed_valid:
            notes.append(invalid_reason)
            selected_card_number = None

    if card_candidate and (
        not selected_card_number
        or card_candidate.source == "barcode"
        or card_candidate.confidence_score >= parsed_confidence
    ):
        selected_card_number = card_candidate.value
        confidence = max(confidence, card_candidate.confidence_score)
        notes.append(
            f"card number/code selected from {card_candidate.source} candidate"
        )

    if pin_candidate and (
        not selected_pin or pin_candidate.confidence_score >= max(parsed_confidence - 0.12, 0.5)
    ):
        selected_pin = pin_candidate.value
        confidence = max(confidence, pin_candidate.confidence_score)
        notes.append(f"PIN selected from {pin_candidate.source} candidate")

    if profile and profile.credential_type == "redemption_code_only":
        selected_pin = None
        notes.append("PIN intentionally ignored for redemption-code-only brand")
    elif profile and profile.key == "best_buy":
        if pin_candidate and pin_candidate.confidence_score >= 0.75:
            selected_pin = pin_candidate.value
            confidence = max(confidence, pin_candidate.confidence_score)
            notes.append(
                f"Best Buy PIN selected from {pin_candidate.source} candidate"
            )
        else:
            selected_pin = None
            notes.append(
                "Best Buy PIN left blank because no reliable PIN-label or "
                "card-number-adjacent candidate was found"
            )

    credential_type = profile.credential_type if profile else "Detected Pair"

    return selected_card_number, selected_pin, confidence, (
        f"Detected Credential Type: {credential_type}. "
        + ("; ".join(notes) if notes else "legacy parser selected values")
    )


def run_extraction_trial(
    image: CardImage,
    *,
    brand: str | None,
    rules: BrandParsingRules | None,
    rotation_degrees: int,
    ocr_image_path: str,
    ocr_image_source: str,
    apply_zones: bool,
    zones: list[dict] | None = None,
    layout_name: str | None = None,
) -> dict:
    raw_text, spatial_tokens = extract_text_and_tokens(
        ocr_image_path,
        rotation_degrees=rotation_degrees,
    )
    barcode_details = safe_decode_barcode_details(
        ocr_image_path,
        rotation_degrees=rotation_degrees,
    )
    barcode_values = [
        str(detail.get("decoded_value") or "")
        for detail in barcode_details
        if detail.get("decoded_value")
    ]

    combined_text = build_combined_ocr_text(
        raw_text=raw_text,
        spatial_tokens=spatial_tokens,
        barcode_values=barcode_values,
        rotation_degrees=rotation_degrees,
    )
    combined_text = (
        f"OCR_IMAGE_SOURCE: {ocr_image_source}\n"
        f"OCR_IMAGE_PATH: {ocr_image_path}\n\n"
        f"{combined_text}"
    )
    if apply_zones:
        combined_text = append_zone_ocr_text(
            combined_text=combined_text,
            image_path=ocr_image_path,
            zones=zones or [],
            layout_name=layout_name,
            rotation_degrees=rotation_degrees,
        )
    combined_text += format_barcode_details(barcode_details)
    parsed = parse_card_data(
        raw_text=combined_text,
        brand=brand,
    )
    candidates = build_extraction_candidates(
        combined_text,
        brand=brand,
        rules=rules,
    )
    selected_card_number, selected_pin, selected_confidence, selection_notes = (
        selected_credential_values(
            brand=brand,
            parsed_card_number=parsed.card_number,
            parsed_pin=parsed.pin,
            parsed_confidence=parsed.confidence_score,
            candidates=candidates,
        )
    )

    return {
        "ocr_image_source": ocr_image_source,
        "ocr_image_path": ocr_image_path,
        "layout_name": layout_name,
        "rotation_degrees": rotation_degrees,
        "combined_text": combined_text,
        "parsed": parsed,
        "selected_card_number": selected_card_number,
        "selected_pin": selected_pin,
        "selected_confidence": selected_confidence,
        "selection_notes": selection_notes,
        "candidates": candidates,
        "score": extraction_score(
            brand=brand,
            parsed_confidence=selected_confidence,
            parsed_card_number=selected_card_number,
            parsed_pin=selected_pin,
            candidates=candidates,
            barcode_values=barcode_values,
        ),
    }


def clear_gift_card_ocr_artifacts(db: Session, gift_card_id: int) -> None:
    db.query(ExtractionCandidate).filter(
        ExtractionCandidate.gift_card_id == gift_card_id,
    ).delete(synchronize_session=False)
    db.query(ExtractionProfileMetric).filter(
        ExtractionProfileMetric.gift_card_id == gift_card_id,
    ).delete(synchronize_session=False)
    db.query(ExtractionAttempt).filter(
        ExtractionAttempt.gift_card_id == gift_card_id,
    ).delete(synchronize_session=False)
    gift_card = db.query(GiftCard).filter(GiftCard.id == gift_card_id).first()
    if gift_card:
        gift_card.detected_card_number = None
        gift_card.detected_pin = None


def set_gift_card_ocr_state(db: Session, gift_card_id: int, state: str) -> None:
    gift_card = db.query(GiftCard).filter(GiftCard.id == gift_card_id).first()
    if gift_card:
        gift_card.ocr_status = state


def run_card_image_extraction(
    db: Session,
    image: CardImage,
    rotation_degrees: int | None = None,
) -> ExtractionAttempt:
    gift_card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
    brand = gift_card.brand if gift_card else None
    rules = get_brand_rules(db, gift_card)
    set_gift_card_ocr_state(db, image.gift_card_id, OCR_STATE_PREPROCESSING)
    db.commit()

    preprocessing_rotation = rotation_degrees or 0
    processed_path, preprocessing_method = preprocess_card_image_with_rotation(
        image.original_image_url,
        UPLOAD_DIR,
        rotation_degrees=preprocessing_rotation,
        brand=brand,
        ocr_zones=rules.ocr_zones if rules else None,
    )
    image.processed_image_url = processed_path
    set_gift_card_ocr_state(db, image.gift_card_id, OCR_STATE_CANONICAL_READY)
    db.commit()

    trials = []
    trial_errors: list[str] = []
    template_layouts = parse_ocr_layouts(rules)
    if template_layouts:
        set_gift_card_ocr_state(db, image.gift_card_id, OCR_STATE_ZONES_READY)
        db.commit()
    else:
        template_layouts = [
            {
                "layout_name": "no_template",
                "zones": [],
            }
        ]

    for layout in template_layouts:
        layout_name = str(layout.get("layout_name") or "default")
        try:
            trials.append(
                run_extraction_trial(
                    image,
                    brand=brand,
                    rules=rules,
                    rotation_degrees=0,
                    ocr_image_path=image.processed_image_url,
                    ocr_image_source="canonical",
                    apply_zones=bool(layout.get("zones")),
                    zones=layout.get("zones", []),
                    layout_name=layout_name,
                )
            )
        except Exception as exc:
            trial_errors.append(f"canonical/{layout_name}: {exc}")

    if not trials:
        raise RuntimeError(
            "OCR/barcode extraction failed for all rotations: "
            + "; ".join(trial_errors)
        )

    best_trial = max(trials, key=lambda trial: trial["score"])
    combined_text = best_trial["combined_text"]
    parsed = best_trial["parsed"]
    selected_card_number = best_trial["selected_card_number"]
    selected_pin = best_trial["selected_pin"]
    selected_confidence = best_trial["selected_confidence"]
    selection_notes = best_trial["selection_notes"]
    candidates = best_trial["candidates"]
    selected_rotation = best_trial["rotation_degrees"]
    selected_image_source = best_trial["ocr_image_source"]
    selected_layout_name = best_trial.get("layout_name") or "no_template"
    template_metadata = parse_ocr_template_metadata(rules)
    profile = brand_profile_for(brand)
    persisted_canonical_rotation = 0
    mode_results = "\n".join(
        (
            f"{trial['ocr_image_source']}|rotation={trial['rotation_degrees']}|"
            f"layout={trial.get('layout_name') or 'none'}|"
            f"score={trial['score']:.4f}|confidence={trial['selected_confidence']:.4f}|"
            f"card={bool(trial['selected_card_number'])}|"
            f"pin={bool(trial['selected_pin'])}|"
            f"candidates={len([candidate for candidate in trial['candidates'] if candidate.candidate_type != 'rejected'])}"
        )
        for trial in sorted(trials, key=lambda item: item["score"], reverse=True)
    )

    if candidates:
        combined_text += "\n\nEXTRACTION_CANDIDATES:\n"

        for candidate in candidates:
            combined_text += (
                f"\n[{candidate.source}] "
                f"{candidate.candidate_type} "
                f"{candidate.value} "
                f"(confidence={candidate.confidence_score}) "
                f"{candidate.notes}"
            )

    extraction = ExtractionAttempt(
        gift_card_id=image.gift_card_id,
        method="ocr_tesseract_barcode_auto_rotate",
        extracted_card_number=selected_card_number,
        extracted_pin=selected_pin,
        confidence_score=selected_confidence,
        raw_text=(
            f"OCR_SELECTED_ROTATION_DEGREES: {selected_rotation}\n"
            f"OCR_SELECTED_IMAGE_SOURCE: {selected_image_source}\n"
            f"OCR_SELECTED_TEMPLATE_LAYOUT: {selected_layout_name}\n"
            f"OCR_CANONICAL_IMAGE: {image.processed_image_url or 'none'}\n"
            f"OCR_TRANSFORM_CHAIN: original -> "
            f"manual_rotation_{(rotation_degrees or 0) % 360} -> "
            f"{preprocessing_method} -> canonical_zone_space\n"
            f"OCR_TEMPLATE_TRAINED_ORIENTATION: "
            f"{template_metadata.get('trained_orientation', 'unknown')}\n"
            f"OCR_TEMPLATE_ROTATION_TRIALS: "
            f"0\n"
            f"OCR_APPLIED_TEMPLATE_ROTATION: 0\n"
            f"OCR_CANONICAL_PERSISTED_ROTATION: {persisted_canonical_rotation}\n"
            f"OCR_TEMPLATE_CANONICAL_SIZE: "
            f"{template_metadata.get('canonical_width', 'unknown')}x"
            f"{template_metadata.get('canonical_height', 'unknown')}\n"
            f"OCR_ROTATION_SCORE: {best_trial['score']}\n\n"
            f"OCR_BRAND_PROFILE: {profile.key if profile else 'generic'}\n"
            f"OCR_DETECTED_CREDENTIAL_TYPE: "
            f"{profile.credential_type if profile else 'Detected Pair'}\n"
            f"OCR_PREPROCESSING: {preprocessing_method}\n"
            f"OCR_MODE_RESULTS:\n{mode_results}\n"
            f"OCR_SELECTION_NOTES: {selection_notes}\n"
            f"OCR_LEGACY_PARSER_NOTES: {parsed.notes}\n\n"
            f"{combined_text}"
        ),
    )

    db.add(extraction)
    db.commit()
    db.refresh(extraction)

    db.add(
        ExtractionProfileMetric(
            extraction_attempt_id=extraction.id,
            gift_card_id=image.gift_card_id,
            brand=brand,
            profile_key=profile.key if profile else "generic",
            detected_credential_type=(
                profile.credential_type if profile else "Detected Pair"
            ),
            selected_rotation_degrees=selected_rotation,
            structured_score=best_trial["score"],
            selected_card_number=bool(selected_card_number),
            selected_pin=bool(selected_pin),
            candidate_count=len(
                [
                    candidate
                    for candidate in candidates
                    if candidate.candidate_type != "rejected"
                ]
            ),
            rejected_candidate_count=len(
                [
                    candidate
                    for candidate in candidates
                    if candidate.candidate_type == "rejected"
                ]
            ),
        )
    )

    (
        db.query(ExtractionCandidate)
        .filter(ExtractionCandidate.gift_card_id == image.gift_card_id)
        .delete(synchronize_session=False)
    )

    for candidate in candidates:
        candidate_row = ExtractionCandidate(
            extraction_attempt_id=extraction.id,
            gift_card_id=image.gift_card_id,
            candidate_type=candidate.candidate_type,
            source=candidate.source,
            value=candidate.value,
            confidence_score=candidate.confidence_score,
            notes=candidate.notes,
        )

        db.add(candidate_row)

    db.commit()

    return extraction


def run_card_image_extraction_job(card_image_id: int) -> None:
    db: Session = SessionLocal()

    try:
        image = db.query(CardImage).filter(CardImage.id == card_image_id).first()

        if not image:
            return

        gift_card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
        if gift_card:
            gift_card.ocr_status = OCR_STATE_PREPROCESSING
            db.commit()

        try:
            run_card_image_extraction(db, image)
            gift_card = (
                db.query(GiftCard)
                .filter(GiftCard.id == image.gift_card_id)
                .first()
            )
            if gift_card:
                gift_card.ocr_status = OCR_STATE_OCR_READY
                db.commit()
        except Exception as exc:
            db.rollback()
            gift_card = (
                db.query(GiftCard)
                .filter(GiftCard.id == image.gift_card_id)
                .first()
            )
            if gift_card:
                gift_card.ocr_status = "failed"
                db.commit()
            print("OCR/barcode extraction failed:", exc)
    finally:
        db.close()


@router.post("/upload")
async def upload_card_image(
    background_tasks: BackgroundTasks,
    gift_card_id: int = Form(...),
    file: UploadFile = File(...),
):
    extension = Path(file.filename).suffix
    filename = f"{uuid4()}{extension}"
    file_path = UPLOAD_DIR / filename

    contents = await file.read()

    with open(file_path, "wb") as f:
        f.write(contents)

    db: Session = SessionLocal()

    try:
        image = CardImage(
            gift_card_id=gift_card_id,
            image_type="primary",
            original_image_url=str(file_path),
        )

        db.add(image)
        gift_card = db.query(GiftCard).filter(GiftCard.id == gift_card_id).first()
        if gift_card:
            clear_gift_card_ocr_artifacts(db, gift_card_id)
            gift_card.ocr_status = OCR_STATE_UPLOADING
        db.commit()
        db.refresh(image)

        background_tasks.add_task(run_card_image_extraction_job, image.id)

        return {
            "id": image.id,
            "gift_card_id": image.gift_card_id,
            "image_type": image.image_type,
            "original_image_url": image.original_image_url,
            "processed_image_url": image.processed_image_url,
            "created_at": image.created_at,
            "ocr_status": OCR_STATE_UPLOADING,
            "message": "Image uploaded. OCR queued.",
        }

    finally:
        db.close()


@router.post("/{card_image_id}/test-zone")
def test_card_image_ocr_zone(card_image_id: int, payload: OCRZoneTestPayload):
    db: Session = SessionLocal()

    try:
        image = db.query(CardImage).filter(CardImage.id == card_image_id).first()

        if not image:
            raise HTTPException(status_code=404, detail="Card image not found")

        gift_card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
        brand = gift_card.brand if gift_card else None
        rules = get_brand_rules(db, gift_card)
        if not image.processed_image_url:
            raise HTTPException(
                status_code=409,
                detail="Canonical OCR image is not ready yet.",
            )
        image_path = image.processed_image_url
        image_source = "canonical"
        rotation_degrees = 0
        request_started_at = time.monotonic()
        transform_chain = "original -> stored canonical OCR image -> OCR crop"
        region_result = extract_region_ocr_result(
            image_path,
            x_pct=payload.x_pct,
            y_pct=payload.y_pct,
            width_pct=payload.width_pct,
            height_pct=payload.height_pct,
            rotation_degrees=rotation_degrees,
            horizontal_padding_pct=0.10,
            vertical_padding_pct=0.20,
        )
        crop_duration_ms = round((time.monotonic() - request_started_at) * 1000)
        zone_text = region_result.text
        zone_tokens = region_result.tokens
        parsing_started_at = time.monotonic()
        def candidate_payload(candidate):
            return {
                "candidate_type": candidate.candidate_type,
                "source": candidate.source,
                "value": candidate.value,
                "confidence_score": candidate.confidence_score,
                "notes": candidate.notes,
            }

        combined_text = (
            "\n\nOCR_ZONE_CROPS:\n"
            f"ZONE|{payload.zone_name}|{payload.zone_type}|1|"
            f"{payload.expected_pattern or ''}|{payload.expected_length or ''}|"
            f"{payload.x_pct}|{payload.y_pct}|{payload.width_pct}|{payload.height_pct}\n"
            f"{zone_text.strip() or 'NO_TEXT'}"
            f"{format_spatial_tokens(zone_tokens)}\nENDZONE"
        )
        candidates = build_extraction_candidates(
            combined_text,
            brand=brand,
            rules=rules,
        )
        promoted_candidates = [
            candidate
            for candidate in candidates
            if candidate.candidate_type != "rejected"
        ]
        pass_candidate_rows: list[tuple[dict, BuiltExtractionCandidate]] = []
        preferred_candidate_type = (
            "pin"
            if payload.zone_type == "pin"
            else "card_number"
            if payload.zone_type in {"card_number", "barcode", "redemption_code"}
            else None
        )

        for pass_result in region_result.pass_results:
            pass_combined_text = (
                "\n\nOCR_ZONE_CROPS:\n"
                f"ZONE|{payload.zone_name}|{payload.zone_type}|1|"
                f"{payload.expected_pattern or ''}|{payload.expected_length or ''}|"
                f"{payload.x_pct}|{payload.y_pct}|{payload.width_pct}|{payload.height_pct}\n"
                f"{pass_result['text'].strip() or 'NO_TEXT'}\nENDZONE"
            )
            pass_candidates = build_extraction_candidates(
                pass_combined_text,
                brand=brand,
                rules=rules,
            )
            pass_useful_candidates = [
                candidate
                for candidate in pass_candidates
                if candidate.candidate_type != "rejected"
            ]
            pass_result["candidates"] = [
                candidate_payload(candidate) for candidate in pass_useful_candidates[:5]
            ]
            pass_result["best_candidate"] = (
                candidate_payload(pass_useful_candidates[0])
                if pass_useful_candidates
                else None
            )

            for candidate in pass_useful_candidates:
                pass_candidate_rows.append((pass_result, candidate))
                if not any(
                    existing.candidate_type == candidate.candidate_type
                    and existing.value == candidate.value
                    for existing in promoted_candidates
                ):
                    promoted_candidates.append(candidate)

        aggregate_candidates = aggregate_zone_pass_candidates(
            pass_candidate_rows,
            preferred_candidate_type=preferred_candidate_type,
        )
        for candidate in aggregate_candidates:
            promoted_candidates = [
                existing
                for existing in promoted_candidates
                if not (
                    existing.candidate_type == candidate.candidate_type
                    and existing.value == candidate.value
                )
            ]
            promoted_candidates.append(candidate)

        useful_candidates = [
            candidate for candidate in promoted_candidates if candidate.candidate_type != "rejected"
        ]
        useful_candidates.sort(
            key=lambda candidate: (
                1
                if preferred_candidate_type
                and candidate.candidate_type == preferred_candidate_type
                else 0,
                candidate.confidence_score,
            ),
            reverse=True,
        )
        best_candidate = useful_candidates[0] if useful_candidates else None
        parsing_duration_ms = round((time.monotonic() - parsing_started_at) * 1000)

        return {
            "image_source": image_source,
            "rotation_degrees": rotation_degrees,
            "transform_chain": transform_chain,
            "source_image_dimensions": {
                "width": region_result.image_width,
                "height": region_result.image_height,
            },
            "selected_crop": {
                "x_px": region_result.selected_left,
                "y_px": region_result.selected_top,
                "width_px": region_result.selected_width,
                "height_px": region_result.selected_height,
                "x_pct": payload.x_pct,
                "y_pct": payload.y_pct,
                "width_pct": payload.width_pct,
                "height_pct": payload.height_pct,
            },
            "crop": {
                "x_pct": payload.x_pct,
                "y_pct": payload.y_pct,
                "width_pct": payload.width_pct,
                "height_pct": payload.height_pct,
                "x_px": region_result.crop_left,
                "y_px": region_result.crop_top,
                "width_px": region_result.crop_width,
                "height_px": region_result.crop_height,
            },
            "selected_crop_image_data_url": region_result.selected_crop_data_url,
            "crop_image_data_url": region_result.crop_data_url,
            "debug_image_paths": region_result.debug_image_paths,
            "timed_out": region_result.timed_out,
            "timing_ms": region_result.timing_ms,
            "stage_timings": [
                *region_result.stage_timings,
                {
                    "stage": "candidate_parsing",
                    "duration_ms": parsing_duration_ms,
                    "candidate_count": len(candidates),
                    "useful_candidate_count": len(useful_candidates),
                },
                {
                    "stage": "request_total",
                    "duration_ms": crop_duration_ms + parsing_duration_ms,
                },
            ],
            "ocr_passes": region_result.pass_results,
            "raw_text": zone_text,
            "confidence": best_candidate.confidence_score if best_candidate else 0,
            "best_candidate": {
                **candidate_payload(best_candidate),
            }
            if best_candidate
            else None,
            "candidates": [
                candidate_payload(candidate)
                for candidate in candidates[:12]
            ],
            "promoted_candidates": [
                candidate_payload(candidate) for candidate in useful_candidates[:12]
            ],
        }

    finally:
        db.close()


@router.post("/{card_image_id}/rescan")
def rescan_card_image(card_image_id: int, rotation_degrees: int | None = None):
    db: Session = SessionLocal()

    try:
        image = db.query(CardImage).filter(CardImage.id == card_image_id).first()

        if not image:
            raise HTTPException(status_code=404, detail="Card image not found")

        gift_card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
        if gift_card:
            clear_gift_card_ocr_artifacts(db, image.gift_card_id)
            gift_card.ocr_status = OCR_STATE_PREPROCESSING
            db.commit()

        try:
            extraction = run_card_image_extraction(
                db,
                image,
                rotation_degrees=rotation_degrees,
            )
        except Exception as exc:
            db.rollback()
            gift_card = (
                db.query(GiftCard)
                .filter(GiftCard.id == image.gift_card_id)
                .first()
            )
            if gift_card:
                gift_card.ocr_status = "failed"
                db.commit()
            raise HTTPException(
                status_code=500,
                detail=f"Card image OCR re-scan failed: {exc}",
            ) from exc
        gift_card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
        if gift_card:
            gift_card.ocr_status = OCR_STATE_OCR_READY
            db.commit()

        return {
            "extraction_attempt_id": extraction.id,
            "gift_card_id": extraction.gift_card_id,
            "message": "Card image OCR re-scanned.",
        }

    finally:
        db.close()
