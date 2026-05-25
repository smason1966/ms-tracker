from __future__ import annotations

import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from PIL import Image
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
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
    find_card_contour,
    four_point_transform,
    read_image_respecting_exif,
    save_rotated_canonical_image,
)
from app.services.ocr import (
    OCRToken,
    extract_region_ocr_result,
    extract_text_and_tokens,
)
from app.services.card_image_schema import ensure_card_image_schema
from app.services.attachments import record_attachment
from app.services.ocr_debug import (
    OCR_DEBUG_DIR,
    OCR_TEMP_DIR,
    OCR_DEBUG_WRITE_WARNING,
    OCRDebugRun,
    current_ocr_debug_run,
    ocr_debug_max_files_from_env,
    ocr_debug_run,
)
from app.services.upload_storage import (
    physical_upload_path,
    upload_dir,
)
from app.services.storage import object_key_for, storage

router = APIRouter(prefix="/card-images", tags=["card-images"])
logger = logging.getLogger(__name__)

UPLOAD_DIR = upload_dir("card-images")
ATTACHMENT_RETENTION_DAYS = 365

OCR_STATE_UPLOADING = "uploading"
OCR_STATE_QUEUED = "queued"
OCR_STATE_PREPROCESSING = "preprocessing"
OCR_STATE_CANONICAL_READY = "canonical_ready"
OCR_STATE_ZONES_READY = "zones_ready"
OCR_STATE_OCR_READY = "ocr_ready"
OCR_WORKER_MAX_CONCURRENCY = max(
    1,
    int(os.getenv("OCR_WORKER_MAX_CONCURRENCY", "1")),
)
ocr_executor = ThreadPoolExecutor(
    max_workers=OCR_WORKER_MAX_CONCURRENCY,
    thread_name_prefix="card-image-ocr",
)

DEFAULT_ACTIVE_BEST_BUY_LAYOUT_NAMES = {
    "best_buy_barcode_above_number",
    "best_buy_number_between_bars",
}
MANAGED_BEST_BUY_LAYOUT_NAMES = {
    "best_buy_barcode_above_number",
    "best_buy_barcode_below_number",
    "best_buy_number_between_bars",
    "best_buy_legacy_small_pin",
    "best_buy_unknown_manual",
}


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
    coordinate_mode: str = "auto"
    card_boundary: dict | None = None


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


def ensure_card_image_columns(db: Session) -> None:
    ensure_card_image_schema(db)


def parse_ocr_layouts(rules: BrandParsingRules | None) -> list[dict]:
    if not rules or not rules.ocr_zones:
        return []

    try:
        value = json.loads(rules.ocr_zones)
    except json.JSONDecodeError:
        return []

    raw_layouts: list[dict]

    parent_coordinate_space = (
        str(value.get("coordinate_space") or "")
        if isinstance(value, dict)
        else ""
    )

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
                if isinstance(layout, dict)
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
        layout_name = str(
            layout.get("layout_name")
            or layout.get("name")
            or f"layout_{layout_index}"
        )
        if layout.get("active") is False:
            continue
        if (
            layout_name in MANAGED_BEST_BUY_LAYOUT_NAMES
            and layout.get("active_managed") is not True
            and layout_name not in DEFAULT_ACTIVE_BEST_BUY_LAYOUT_NAMES
        ):
            continue

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
                "layout_name": layout_name,
                "zones": sorted(zones, key=lambda item: item["priority"]),
                "coordinate_space": str(
                    layout.get("coordinate_space")
                    or parent_coordinate_space
                    or "card_boundary_relative"
                ),
            }
        )

    return parsed_layouts


def parse_ocr_zones(rules: BrandParsingRules | None) -> list[dict]:
    layouts = parse_ocr_layouts(rules)
    return layouts[0]["zones"] if layouts else []


def card_boundary_zone(zones: list[dict] | None) -> dict | None:
    for zone in zones or []:
        if (
            isinstance(zone, dict)
            and str(zone.get("zone_type") or "").strip().lower() == "card_boundary"
        ):
            return zone
    return None


def normalized_zone_box(zone: dict) -> dict:
    return {
        "x_pct": max(0.0, min(float(zone.get("x_pct") or 0), 100.0)),
        "y_pct": max(0.0, min(float(zone.get("y_pct") or 0), 100.0)),
        "width_pct": max(0.0, min(float(zone.get("width_pct") or 0), 100.0)),
        "height_pct": max(0.0, min(float(zone.get("height_pct") or 0), 100.0)),
    }


def zone_to_image_space(zone: dict, boundary: dict | None) -> dict:
    if (
        not boundary
        or str(zone.get("zone_type") or "").strip().lower() == "card_boundary"
    ):
        return dict(zone)

    boundary_box = normalized_zone_box(boundary)
    zone_box = normalized_zone_box(zone)
    transformed = dict(zone)
    transformed["source_coordinate_mode"] = "card_boundary_relative"
    transformed["source_x_pct"] = zone_box["x_pct"]
    transformed["source_y_pct"] = zone_box["y_pct"]
    transformed["source_width_pct"] = zone_box["width_pct"]
    transformed["source_height_pct"] = zone_box["height_pct"]
    transformed["x_pct"] = boundary_box["x_pct"] + (
        zone_box["x_pct"] * boundary_box["width_pct"] / 100
    )
    transformed["y_pct"] = boundary_box["y_pct"] + (
        zone_box["y_pct"] * boundary_box["height_pct"] / 100
    )
    transformed["width_pct"] = zone_box["width_pct"] * boundary_box["width_pct"] / 100
    transformed["height_pct"] = zone_box["height_pct"] * boundary_box["height_pct"] / 100
    transformed["coordinate_mode"] = "full_image_from_card_boundary"
    return transformed


def zones_to_image_space(zones: list[dict] | None) -> list[dict]:
    boundary = card_boundary_zone(zones)
    return [zone_to_image_space(zone, boundary) for zone in zones or []]


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
        source_path = physical_upload_path(image_path) or Path(image_path)
        return decode_barcode_details(str(source_path), rotation_degrees=rotation_degrees)
    except Exception:
        return []


def is_best_buy_brand(brand: str | None) -> bool:
    return "best buy" in (brand or "").strip().lower()


def barcode_attempt_acceptance(
    *,
    decoded_value: str,
    brand: str | None,
    source: str,
) -> tuple[str, str]:
    normalized_value = "".join(character for character in decoded_value if character.isdigit())
    profile = brand_profile_for(brand)

    if not normalized_value:
        return "", "rejected: no numeric barcode value"

    is_valid, validation_note = validate_brand_card_number_candidate(
        normalized_value,
        profile=profile,
        source=source,
    )

    if is_valid:
        return normalized_value, f"accepted: {validation_note}"

    return normalized_value, validation_note


def write_card_crop_for_barcode_attempt(image_path: str) -> str | None:
    source_path = physical_upload_path(image_path) or Path(image_path)
    image = read_image_respecting_exif(str(source_path))
    if image is None:
        return None

    contour = find_card_contour(image)
    if contour is None:
        return None

    cropped = four_point_transform(image, contour)
    if min(cropped.shape[:2]) < 120:
        return None

    OCR_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    crop_path = OCR_TEMP_DIR / f"barcode-crop-{uuid4().hex}.jpg"
    try:
        import cv2

        cv2.imwrite(str(crop_path), cropped, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    except Exception:
        return None

    return str(crop_path)


def collect_best_buy_barcode_attempts(
    image: CardImage,
    brand: str | None,
    *,
    barcode_zones: list[dict] | None = None,
) -> tuple[list[dict], list[str]]:
    if not is_best_buy_brand(brand):
        return [], []

    sources: list[tuple[str, str]] = [("original", image.original_image_url)]
    if image.processed_image_url:
        sources.append(("saved_ocr", image.processed_image_url))

    crop_path = write_card_crop_for_barcode_attempt(image.original_image_url)
    if crop_path:
        sources.append(("card_crop", crop_path))

    attempts: list[dict] = []
    accepted_values: list[str] = []

    for source_name, image_path in sources:
        for rotation in (0, 90, 180, 270):
            details = safe_decode_barcode_details(image_path, rotation)
            if not details:
                attempts.append(
                    {
                        "source": source_name,
                        "rotation_degrees": rotation,
                        "detected": False,
                        "barcode_type": "",
                        "decoded_value": "",
                        "normalized_candidate": "",
                        "accepted": False,
                        "reason": "no barcode decoded",
                    }
                )
                continue

            for detail in details:
                decoded_value = str(detail.get("decoded_value") or "")
                normalized_value, reason = barcode_attempt_acceptance(
                    decoded_value=decoded_value,
                    brand=brand,
                    source=f"{source_name}/{rotation}",
                )
                accepted = reason.startswith("accepted")
                if accepted and normalized_value not in accepted_values:
                    accepted_values.append(normalized_value)

                attempts.append(
                    {
                        "source": source_name,
                        "rotation_degrees": rotation,
                        "detected": True,
                        "barcode_type": str(detail.get("barcode_type") or ""),
                        "decoded_value": decoded_value,
                        "normalized_candidate": normalized_value,
                        "accepted": accepted,
                        "reason": reason,
                    }
                )

    if barcode_zones and image.processed_image_url:
        for zone in barcode_zones:
            zone_attempts, zone_values, _ = collect_barcode_zone_attempts(
                image_path=image.processed_image_url,
                brand=brand,
                zone=zone,
                source="saved_barcode_zone",
            )
            attempts.extend(zone_attempts)
            for value in zone_values:
                if value not in accepted_values:
                    accepted_values.append(value)

    if crop_path:
        Path(crop_path).unlink(missing_ok=True)

    return attempts, accepted_values


def format_barcode_attempts(attempts: list[dict]) -> str:
    if not attempts:
        return ""

    lines = ["\n\nBARCODE_SCAN_ATTEMPTS:"]
    for attempt in attempts:
        lines.append(
            "|".join(
                [
                    str(attempt.get("source") or ""),
                    str(attempt.get("rotation_degrees") or 0),
                    "yes" if attempt.get("detected") else "no",
                    str(attempt.get("barcode_type") or ""),
                    str(attempt.get("decoded_value") or ""),
                    str(attempt.get("normalized_candidate") or ""),
                    "accepted" if attempt.get("accepted") else "rejected",
                    str(attempt.get("reason") or ""),
                ]
            )
        )

    return "\n".join(lines)


def save_zone_crop_for_barcode_decode(
    image_path: str,
    *,
    x_pct: float,
    y_pct: float,
    width_pct: float,
    height_pct: float,
    horizontal_padding_pct: float = 0.0,
    vertical_padding_pct: float = 0.0,
    label: str = "zone",
    debug_run: OCRDebugRun | None = None,
) -> tuple[str, dict, bool]:
    source_path = physical_upload_path(image_path) or Path(image_path)
    with Image.open(source_path) as image:
        image_width, image_height = image.size
        selected_left = max(0, int(image_width * (x_pct / 100)))
        selected_top = max(0, int(image_height * (y_pct / 100)))
        selected_right = min(
            image_width,
            selected_left + int(image_width * (width_pct / 100)),
        )
        selected_bottom = min(
            image_height,
            selected_top + int(image_height * (height_pct / 100)),
        )
        pad_x = int((selected_right - selected_left) * horizontal_padding_pct)
        pad_y = int((selected_bottom - selected_top) * vertical_padding_pct)
        left = max(0, selected_left - pad_x)
        top = max(0, selected_top - pad_y)
        right = min(image_width, selected_right + pad_x)
        bottom = min(image_height, selected_bottom + pad_y)

        if right <= left or bottom <= top:
            raise ValueError("Barcode zone crop has no area.")

        crop = image.crop((left, top, right, bottom))
        effective_debug_run = debug_run or current_ocr_debug_run()
        keep_debug_path = effective_debug_run.reserve_file()
        crop_dir = (
            OCR_DEBUG_DIR
            if keep_debug_path
            else OCR_TEMP_DIR
        )
        crop_path = crop_dir / f"barcode-zone-{uuid4().hex}.png"
        try:
            crop_dir.mkdir(parents=True, exist_ok=True)
            crop.save(crop_path)
        except OSError as exc:
            logger.warning(OCR_DEBUG_WRITE_WARNING, exc_info=True)
            raise RuntimeError("debug crop write failed") from exc

    return str(crop_path), {
        "image_width": image_width,
        "image_height": image_height,
        "x_pct": x_pct,
        "y_pct": y_pct,
        "width_pct": width_pct,
        "height_pct": height_pct,
        "x_px": left,
        "y_px": top,
        "width_px": right - left,
        "height_px": bottom - top,
        "label": label,
    }, keep_debug_path


def collect_barcode_zone_attempts(
    *,
    image_path: str,
    brand: str | None,
    zone: dict,
    source: str,
    debug_run: OCRDebugRun | None = None,
) -> tuple[list[dict], list[str], list[str]]:
    attempts: list[dict] = []
    accepted_values: list[str] = []
    debug_paths: list[str] = []
    crop_specs = [
        ("selected_zone", 0.0, 0.0),
        ("padded_zone", 0.10, 0.20),
    ]

    for crop_label, horizontal_padding, vertical_padding in crop_specs:
        try:
            crop_path, _, keep_debug_path = save_zone_crop_for_barcode_decode(
                image_path,
                x_pct=float(zone["x_pct"]),
                y_pct=float(zone["y_pct"]),
                width_pct=float(zone["width_pct"]),
                height_pct=float(zone["height_pct"]),
                horizontal_padding_pct=horizontal_padding,
                vertical_padding_pct=vertical_padding,
                label=crop_label,
                debug_run=debug_run,
            )
        except Exception as exc:
            attempts.append(
                {
                    "source": source,
                    "zone_name": str(zone.get("zone_name") or ""),
                    "crop": crop_label,
                    "rotation": 0,
                    "decoded_value": "",
                    "barcode_type": "",
                    "accepted": False,
                    "rejected_reason": f"crop failed: {exc}",
                }
            )
            continue

        if keep_debug_path:
            debug_paths.append(crop_path)
        try:
            for rotation in (0, 90, 180, 270):
                details = safe_decode_barcode_details(crop_path, rotation)
                if not details:
                    attempts.append(
                        {
                            "source": source,
                            "zone_name": str(zone.get("zone_name") or ""),
                            "crop": crop_label,
                            "rotation": rotation,
                            "decoded_value": "",
                            "barcode_type": "",
                            "accepted": False,
                            "rejected_reason": "no barcode decoded",
                        }
                    )
                    continue

                for detail in details:
                    decoded_value = str(detail.get("decoded_value") or "")
                    normalized_value, reason = barcode_attempt_acceptance(
                        decoded_value=decoded_value,
                        brand=brand,
                        source=f"{source}/{zone.get('zone_name')}/{crop_label}/{rotation}",
                    )
                    accepted = reason.startswith("accepted")
                    if accepted and normalized_value not in accepted_values:
                        accepted_values.append(normalized_value)

                    attempts.append(
                        {
                            "source": source,
                            "zone_name": str(zone.get("zone_name") or ""),
                            "crop": crop_label,
                            "rotation": rotation,
                            "decoded_value": decoded_value,
                            "barcode_type": str(detail.get("barcode_type") or ""),
                            "normalized_candidate": normalized_value,
                            "accepted": accepted,
                            "rejected_reason": "" if accepted else reason,
                        }
                    )
        finally:
            if not keep_debug_path:
                Path(crop_path).unlink(missing_ok=True)

    return attempts, accepted_values, debug_paths


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

    boundary = card_boundary_zone(zones)
    combined_text += (
        "\nOCR_ZONE_COORDINATE_MODE: "
        + ("card_boundary_relative" if boundary else "full_image_relative")
    )
    try:
        source_path = physical_upload_path(image_path) or Path(image_path)
        with Image.open(source_path) as image:
            image_width, image_height = image.size
    except Exception:
        image_width, image_height = 0, 0

    if image_width and image_height:
        combined_text += f"\nOCR_ZONE_IMAGE_NATURAL_SIZE: {image_width}x{image_height}"
    if boundary:
        boundary_box = normalized_zone_box(boundary)
        boundary_pixels = {
            "x": round((boundary_box["x_pct"] / 100) * image_width),
            "y": round((boundary_box["y_pct"] / 100) * image_height),
            "width": round((boundary_box["width_pct"] / 100) * image_width),
            "height": round((boundary_box["height_pct"] / 100) * image_height),
        }
        combined_text += (
            "\nOCR_CARD_BOUNDARY: "
            f"{boundary_box['x_pct']:.4f}|{boundary_box['y_pct']:.4f}|"
            f"{boundary_box['width_pct']:.4f}|{boundary_box['height_pct']:.4f}|"
            f"{boundary_pixels['x']}|{boundary_pixels['y']}|"
            f"{boundary_pixels['width']}|{boundary_pixels['height']}"
        )

    for source_zone in zones:
        zone = zone_to_image_space(source_zone, boundary)
        if zone["zone_type"] in {"card_boundary", "ignore"}:
            continue

        try:
            region_result = extract_region_ocr_result(
                str(physical_upload_path(image_path) or Path(image_path)),
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
            f"{source_zone['x_pct']}|{source_zone['y_pct']}|"
            f"{source_zone['width_pct']}|{source_zone['height_pct']}"
            "\n"
        )
        if boundary:
            combined_text += (
                "ZONE_IMAGE_SPACE|"
                f"{zone['x_pct']:.4f}|{zone['y_pct']:.4f}|"
                f"{zone['width_pct']:.4f}|{zone['height_pct']:.4f}\n"
            )
        if image_width and image_height:
            combined_text += (
                "ZONE_FINAL_PIXEL_CROP|"
                f"{round((zone['x_pct'] / 100) * image_width)}|"
                f"{round((zone['y_pct'] / 100) * image_height)}|"
                f"{round((zone['width_pct'] / 100) * image_width)}|"
                f"{round((zone['height_pct'] / 100) * image_height)}\n"
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
    barcode_attempts: list[dict] | None = None,
    authoritative_barcode_values: list[str] | None = None,
) -> dict:
    physical_ocr_image_path = str(physical_upload_path(ocr_image_path) or Path(ocr_image_path))
    raw_text, spatial_tokens = extract_text_and_tokens(
        physical_ocr_image_path,
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
    for barcode_value in authoritative_barcode_values or []:
        if barcode_value not in barcode_values:
            barcode_values.insert(0, barcode_value)

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
            image_path=physical_ocr_image_path,
            zones=zones or [],
            layout_name=layout_name,
            rotation_degrees=rotation_degrees,
        )
    combined_text += format_barcode_attempts(barcode_attempts or [])
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
        "zone_candidate_count": len(
            [
                candidate
                for candidate in candidates
                if str(candidate.source).startswith("zone")
                and candidate.candidate_type != "rejected"
            ]
        ),
        "score": extraction_score(
            brand=brand,
            parsed_confidence=selected_confidence,
            parsed_card_number=selected_card_number,
            parsed_pin=selected_pin,
            candidates=candidates,
            barcode_values=barcode_values,
        ),
    }


def rotation_trial_has_valid_barcode(trial: dict, brand: str | None) -> bool:
    profile = brand_profile_for(brand)
    return any(
        candidate.candidate_type == "card_number"
        and candidate.source == "barcode"
        and validate_brand_card_number_candidate(
            candidate.value,
            profile=profile,
            source="barcode",
        )[0]
        for candidate in trial.get("candidates", [])
    )


def rotation_trial_has_valid_card_number(trial: dict, brand: str | None) -> bool:
    profile = brand_profile_for(brand)
    card_number = trial.get("selected_card_number")
    return bool(
        card_number
        and validate_brand_card_number_candidate(
            card_number,
            profile=profile,
            source=str(trial.get("ocr_image_source") or "ocr"),
        )[0]
    )


def auto_orientation_priority(trial: dict, brand: str | None) -> tuple:
    profile = brand_profile_for(brand)
    has_valid_barcode = rotation_trial_has_valid_barcode(trial, brand)
    has_card_pin_pair = (
        rotation_trial_has_valid_card_number(trial, brand)
        and bool(trial.get("selected_pin"))
    )
    has_redemption_code = bool(
        profile
        and profile.credential_type == "redemption_code_only"
        and trial.get("selected_card_number")
    )
    useful_candidate_count = len(
        [
            candidate
            for candidate in trial.get("candidates", [])
            if candidate.candidate_type != "rejected"
        ]
    )
    readable_text_length = len(str(trial.get("combined_text") or "").strip())

    return (
        1 if has_valid_barcode else 0,
        1 if has_card_pin_pair else 0,
        1 if has_redemption_code else 0,
        float(trial.get("score") or 0),
        float(trial.get("selected_confidence") or 0),
        useful_candidate_count,
        readable_text_length,
    )


def collect_rotation_barcode_attempts(
    image_path: str,
    *,
    brand: str | None,
    source: str,
    rotation_degrees: int,
) -> tuple[list[dict], list[str]]:
    attempts: list[dict] = []
    accepted_values: list[str] = []
    details = safe_decode_barcode_details(image_path, rotation_degrees)

    if not details:
        return [
            {
                "source": source,
                "rotation_degrees": rotation_degrees,
                "detected": False,
                "barcode_type": "",
                "decoded_value": "",
                "normalized_candidate": "",
                "accepted": False,
                "reason": "no barcode decoded",
            }
        ], []

    for detail in details:
        decoded_value = str(detail.get("decoded_value") or "")
        normalized_value, reason = barcode_attempt_acceptance(
            decoded_value=decoded_value,
            brand=brand,
            source=f"{source}/{rotation_degrees}",
        )
        accepted = reason.startswith("accepted")
        if accepted and normalized_value not in accepted_values:
            accepted_values.append(normalized_value)

        attempts.append(
            {
                "source": source,
                "rotation_degrees": rotation_degrees,
                "detected": True,
                "barcode_type": str(detail.get("barcode_type") or ""),
                "decoded_value": decoded_value,
                "normalized_candidate": normalized_value,
                "accepted": accepted,
                "reason": reason,
            }
        )

    return attempts, accepted_values


def auto_select_review_ocr_orientation(
    image: CardImage,
    *,
    brand: str | None,
    rules: BrandParsingRules | None,
    template_layouts: list[dict],
) -> tuple[str, str, dict]:
    full_image_layouts = [
        {
            "layout_name": "auto_full_image",
            "zones": [],
        }
    ]
    card_crop_path = write_card_crop_for_barcode_attempt(image.original_image_url)
    trials: list[dict] = []
    trial_errors: list[str] = []

    def run_orientation_trials(layouts: list[dict], stage: str) -> None:
        for rotation in (0, 90, 180, 270):
            rotation_attempts: list[dict] = []
            authoritative_values: list[str] = []
            if card_crop_path:
                crop_attempts, crop_values = collect_rotation_barcode_attempts(
                    card_crop_path,
                    brand=brand,
                    source="card_crop",
                    rotation_degrees=rotation,
                )
                rotation_attempts.extend(crop_attempts)
                authoritative_values.extend(crop_values)

            for layout in layouts:
                layout_name = str(layout.get("layout_name") or "default")
                try:
                    trials.append(
                        run_extraction_trial(
                            image,
                            brand=brand,
                            rules=rules,
                            rotation_degrees=rotation,
                            ocr_image_path=image.original_image_url,
                            ocr_image_source=f"auto_original_upload_{stage}",
                            apply_zones=bool(layout.get("zones")),
                            zones=layout.get("zones", []),
                            layout_name=layout_name,
                            barcode_attempts=rotation_attempts,
                            authoritative_barcode_values=authoritative_values,
                        )
                    )
                except Exception as exc:
                    trial_errors.append(f"auto/{stage}/{rotation}/{layout_name}: {exc}")

    run_orientation_trials(full_image_layouts, "full_image")
    best_priority = (
        max(auto_orientation_priority(trial, brand) for trial in trials)
        if trials
        else (0, 0, 0, 0, 0, 0, 0)
    )
    if not any(best_priority[:3]) and template_layouts:
        run_orientation_trials(template_layouts, "template")

    if card_crop_path:
        Path(card_crop_path).unlink(missing_ok=True)

    if trials:
        best_trial = max(
            trials,
            key=lambda trial: auto_orientation_priority(trial, brand),
        )
        selected_rotation = int(best_trial["rotation_degrees"]) % 360
        priority = auto_orientation_priority(best_trial, brand)
        reason = (
            "Auto orientation selected from extraction scoring: "
            f"barcode={bool(priority[0])}, card_pin_pair={bool(priority[1])}, "
            f"redemption_code={bool(priority[2])}, score={best_trial['score']:.4f}, "
            f"layout={best_trial.get('layout_name') or 'none'}."
        )
    else:
        selected_rotation = 0
        best_trial = {
            "score": 0,
            "selected_confidence": 0,
            "layout_name": "none",
        }
        priority = (0, 0, 0, 0, 0, 0, 0)
        reason = (
            "Auto orientation could not score any rotation; saved the original "
            "orientation so manual override remains available. "
            + "; ".join(trial_errors)
        )

    canonical_path, canonical_dimensions = save_rotated_canonical_image(
        str(physical_upload_path(image.original_image_url) or Path(image.original_image_url)),
        UPLOAD_DIR,
        rotation_degrees=selected_rotation,
    )
    canonical_file = Path(canonical_path)
    stored_canonical = storage.save(
        object_key=object_key_for("card-images", canonical_file.name),
        data=canonical_file.read_bytes(),
        original_filename=canonical_file.name,
        content_type="image/jpeg",
    )
    canonical_reference = storage.generate_view_url(stored_canonical.object_key)
    tested_rotations = [
        {
            "rotation_degrees": int(trial["rotation_degrees"]),
            "layout_name": trial.get("layout_name") or "none",
            "score": trial.get("score"),
            "confidence": trial.get("selected_confidence"),
            "valid_barcode": rotation_trial_has_valid_barcode(trial, brand),
            "card_number": bool(trial.get("selected_card_number")),
            "pin": bool(trial.get("selected_pin")),
            "priority": auto_orientation_priority(trial, brand),
        }
        for trial in sorted(
            trials,
            key=lambda trial: auto_orientation_priority(trial, brand),
            reverse=True,
        )
    ]
    canonical_metadata = {
        "selected_rotation": selected_rotation,
        "rotation_degrees": selected_rotation,
        "orientation_source": "auto",
        "orientation_score": best_trial.get("score", 0),
        "orientation_priority": priority,
        "tested_rotations": tested_rotations,
        "reason_selected": reason,
        "coordinate_space": "saved_review_ocr_image_percent",
        "canonical_image_source": "auto_extraction_rotation",
        "saved_review_ocr_source_path": image.original_image_url,
        "saved_review_ocr_source_kind": "original_upload",
        "saved_review_ocr_applied_rotation": selected_rotation,
        "saved_review_ocr_image": canonical_reference,
        "saved_review_ocr_width": canonical_dimensions["width"],
        "saved_review_ocr_height": canonical_dimensions["height"],
        "display_image_source": "saved_review_ocr_image",
        "ocr_image_source": "saved_review_ocr_image",
        "barcode_image_source": "saved_review_ocr_image",
        "auto_orientation_trial_errors": trial_errors,
    }

    return canonical_reference, "auto_extraction_selected_review_ocr_image", canonical_metadata


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
    rebuild_canonical: bool = False,
) -> ExtractionAttempt:
    gift_card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
    brand = gift_card.brand if gift_card else None
    rules = get_brand_rules(db, gift_card)
    set_gift_card_ocr_state(db, image.gift_card_id, OCR_STATE_PREPROCESSING)
    db.commit()

    ensure_card_image_columns(db)
    template_layouts = parse_ocr_layouts(rules)
    if image.processed_image_url and not rebuild_canonical:
        try:
            canonical_metadata = (
                json.loads(image.canonical_transform_metadata)
                if image.canonical_transform_metadata
                else {}
            )
        except json.JSONDecodeError:
            canonical_metadata = {}
        canonical_metadata = {
            "selected_rotation": image.canonical_rotation_degrees,
            "rotation_degrees": image.canonical_rotation_degrees,
            "orientation_source": image.orientation_source or "manual",
            "orientation_score": canonical_metadata.get("orientation_score", "manual"),
            "tested_rotations": canonical_metadata.get("tested_rotations", []),
            "reason_selected": canonical_metadata.get(
                "reason_selected",
                "User saved this visible image as the OCR orientation.",
            ),
            "coordinate_space": "saved_review_ocr_image_percent",
            **canonical_metadata,
        }
        preprocessing_method = "stored_saved_review_ocr_image"
    else:
        processed_path, preprocessing_method, canonical_metadata = auto_select_review_ocr_orientation(
            image,
            brand=brand,
            rules=rules,
            template_layouts=template_layouts,
        )
        image.processed_image_url = processed_path
        image.canonical_rotation_degrees = canonical_metadata.get("rotation_degrees")
        image.orientation_source = canonical_metadata.get("orientation_source")
        image.canonical_transform_metadata = json.dumps(canonical_metadata, default=str)
        db.flush()
        record_attachment(
            db,
            owner_type="card_image",
            owner_id=image.id,
            attachment_type="processed_ocr_image",
            stored=storage.save(
                object_key=object_key_for(
                    "card-images",
                    Path(processed_path).name,
                ),
                data=(physical_upload_path(processed_path) or Path(processed_path)).read_bytes(),
                original_filename=Path(processed_path).name,
                content_type="image/jpeg",
            ),
            retention_until=image.retention_until,
        )
    set_gift_card_ocr_state(db, image.gift_card_id, OCR_STATE_CANONICAL_READY)
    db.commit()

    trials = []
    trial_errors: list[str] = []
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
    barcode_zones: list[dict] = []
    for layout in template_layouts:
        for zone in zones_to_image_space(layout.get("zones", [])):
            if (
                isinstance(zone, dict)
                and str(zone.get("zone_type") or "").strip().lower() == "barcode"
            ):
                barcode_zones.append(zone)

    barcode_attempts, authoritative_barcode_values = collect_best_buy_barcode_attempts(
        image,
        brand,
        barcode_zones=barcode_zones,
    )

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
                    barcode_attempts=barcode_attempts,
                    authoritative_barcode_values=authoritative_barcode_values,
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
    selected_layout_confidence = min(0.99, max(0.0, best_trial["score"] / 4.5))
    template_mismatch = bool(
        is_best_buy_brand(brand)
        and selected_layout_name != "no_template"
        and best_trial.get("zone_candidate_count", 0) == 0
        and not selected_pin
    )
    template_coordinate_source = (
        "card_boundary_relative"
        if any(card_boundary_zone(layout.get("zones", [])) for layout in template_layouts)
        else "full_image_relative"
    )
    template_metadata = parse_ocr_template_metadata(rules)
    profile = brand_profile_for(brand)
    persisted_canonical_rotation = 0
    canonical_tested_rotations = canonical_metadata.get("tested_rotations", [])
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
            f"OCR_SELECTED_TEMPLATE_CONFIDENCE: "
            f"{selected_layout_confidence:.2f}\n"
            f"OCR_TEMPLATE_MISMATCH: {'yes' if template_mismatch else 'no'}\n"
            f"OCR_CANONICAL_IMAGE: {image.processed_image_url or 'none'}\n"
            f"OCR_CANONICAL_ROTATION_DEGREES: "
            f"{canonical_metadata.get('rotation_degrees', 'unknown')}\n"
            f"OCR_CANONICAL_SELECTED_ROTATION: "
            f"{canonical_metadata.get('selected_rotation', 'unknown')}\n"
            f"OCR_CANONICAL_ORIENTATION_SCORE: "
            f"{canonical_metadata.get('orientation_score', 'unknown')}\n"
            f"OCR_CANONICAL_ORIENTATION_SOURCE: "
            f"{canonical_metadata.get('orientation_source', 'unknown')}\n"
            f"OCR_CANONICAL_COORDINATE_SPACE: "
            f"{canonical_metadata.get('coordinate_space', 'unknown')}\n"
            f"OCR_DISPLAY_IMAGE_USED: {image.processed_image_url or 'none'}\n"
            f"OCR_IMAGE_USED: {image.processed_image_url or 'none'}\n"
            f"OCR_BARCODE_IMAGE_USED: saved_review_ocr_image + original/card_crop/barcode_zones\n"
            f"OCR_SAVED_REVIEW_IMAGE_SOURCE: "
            f"{canonical_metadata.get('saved_review_ocr_source_kind', 'unknown')}|"
            f"{canonical_metadata.get('saved_review_ocr_source_path', 'unknown')}\n"
            f"OCR_SAVED_REVIEW_IMAGE_DIMENSIONS: "
            f"{canonical_metadata.get('saved_review_ocr_width', 'unknown')}x"
            f"{canonical_metadata.get('saved_review_ocr_height', 'unknown')}\n"
            f"OCR_TEMPLATE_COORDINATE_SOURCE: {template_coordinate_source}\n"
            f"OCR_TEMPLATE_ZONE_BASIS: {template_coordinate_source}\n"
            f"OCR_TRANSFORM_CHAIN: original -> "
            f"manual_rotation_{(rotation_degrees or 0) % 360} -> "
            f"{preprocessing_method} -> canonical_zone_space\n"
            f"OCR_TEMPLATE_TRAINED_ORIENTATION: "
            f"{template_metadata.get('trained_orientation', 'unknown')}\n"
            f"OCR_TEMPLATE_ROTATION_TRIALS: "
            f"0\n"
            f"OCR_CANONICAL_ORIENTATION_TRIALS: "
            f"{json.dumps(canonical_tested_rotations, default=str)}\n"
            f"OCR_CANONICAL_REASON_SELECTED: "
            f"{canonical_metadata.get('reason_selected', 'unknown')}\n"
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
            f"OCR_BARCODE_ACCEPTED_VALUES: "
            f"{', '.join(authoritative_barcode_values) or 'none'}\n"
            f"OCR_BARCODE_ATTEMPTS: "
            f"{json.dumps(barcode_attempts, default=str)}\n"
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


def run_card_image_extraction_job(
    card_image_id: int,
    rotation_degrees: int | None = None,
) -> None:
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
            logger.info(
                "Starting OCR job",
                extra={
                    "card_image_id": card_image_id,
                    "gift_card_id": image.gift_card_id,
                    "rotation_degrees": rotation_degrees,
                },
            )
            with ocr_debug_run():
                run_card_image_extraction(
                    db,
                    image,
                    rotation_degrees=rotation_degrees,
                )
            gift_card = (
                db.query(GiftCard)
                .filter(GiftCard.id == image.gift_card_id)
                .first()
            )
            if gift_card:
                gift_card.ocr_status = OCR_STATE_OCR_READY
                db.commit()
            logger.info(
                "Finished OCR job",
                extra={
                    "card_image_id": card_image_id,
                    "gift_card_id": image.gift_card_id,
                },
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
            logger.exception(
                "OCR/barcode extraction failed",
                extra={
                    "card_image_id": card_image_id,
                    "gift_card_id": image.gift_card_id,
                },
            )
    finally:
        db.close()


def queue_card_image_extraction(
    card_image_id: int,
    rotation_degrees: int | None = None,
) -> None:
    logger.info(
        "Queueing OCR job",
        extra={
            "card_image_id": card_image_id,
            "rotation_degrees": rotation_degrees,
            "max_concurrency": OCR_WORKER_MAX_CONCURRENCY,
        },
    )
    ocr_executor.submit(
        run_card_image_extraction_job,
        card_image_id,
        rotation_degrees,
    )


@router.post("/upload")
async def upload_card_image(
    gift_card_id: int = Form(...),
    file: UploadFile = File(...),
    image_type: str = Form("primary"),
    attachment_type: str = Form("card_image"),
    run_ocr: bool = Form(True),
    retain_attachment: bool = Form(False),
):
    extension = Path(file.filename).suffix
    filename = f"{uuid4()}{extension}"
    object_key = object_key_for("card-images", filename)

    contents = await file.read()
    stored = storage.save(
        object_key=object_key,
        data=contents,
        original_filename=file.filename,
        content_type=file.content_type,
    )

    db: Session = SessionLocal()

    try:
        ensure_card_image_columns(db)
        db.commit()
        retention_until = datetime.utcnow() + timedelta(days=ATTACHMENT_RETENTION_DAYS)
        image = CardImage(
            gift_card_id=gift_card_id,
            image_type=image_type,
            original_image_url=storage.generate_view_url(stored.object_key),
            original_filename=file.filename,
            attachment_type=attachment_type,
            uploaded_at=datetime.utcnow(),
            retention_until=retention_until,
            retention_status="active",
            retain_attachment=retain_attachment,
        )

        db.add(image)
        db.flush()
        record_attachment(
            db,
            owner_type="card_image",
            owner_id=image.id,
            attachment_type=attachment_type,
            stored=stored,
            retention_until=retention_until,
        )
        gift_card = db.query(GiftCard).filter(GiftCard.id == gift_card_id).first()
        should_run_ocr = (
            run_ocr
            and image_type == "primary"
            and attachment_type == "card_image"
            and not str(extension).lower().endswith(".pdf")
        )
        if gift_card and should_run_ocr:
            clear_gift_card_ocr_artifacts(db, gift_card_id)
            gift_card.ocr_status = OCR_STATE_QUEUED
        db.commit()
        db.refresh(image)
        if should_run_ocr:
            queue_card_image_extraction(image.id)

        return {
            "id": image.id,
            "gift_card_id": image.gift_card_id,
            "image_type": image.image_type,
            "original_image_url": image.original_image_url,
            "original_filename": image.original_filename,
            "processed_image_url": image.processed_image_url,
            "canonical_rotation_degrees": image.canonical_rotation_degrees,
            "orientation_source": image.orientation_source,
            "canonical_transform_metadata": image.canonical_transform_metadata,
            "attachment_type": image.attachment_type,
            "uploaded_at": image.uploaded_at,
            "retention_until": image.retention_until,
            "retention_status": image.retention_status,
            "retain_attachment": image.retain_attachment,
            "purged_at": image.purged_at,
            "created_at": image.created_at,
            "ocr_status": OCR_STATE_QUEUED if should_run_ocr else (gift_card.ocr_status if gift_card else None),
            "message": "Image saved — OCR queued."
            if should_run_ocr
            else "Attachment saved. OCR was not queued.",
        }

    finally:
        db.close()


@router.get("/{card_image_id}/ocr-status")
def get_card_image_ocr_status(card_image_id: int):
    db: Session = SessionLocal()

    try:
        image = db.query(CardImage).filter(CardImage.id == card_image_id).first()

        if not image:
            raise HTTPException(status_code=404, detail="Card image not found")

        gift_card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
        latest_attempt = (
            db.query(ExtractionAttempt)
            .filter(ExtractionAttempt.gift_card_id == image.gift_card_id)
            .order_by(ExtractionAttempt.created_at.desc(), ExtractionAttempt.id.desc())
            .first()
        )
        candidate_count = (
            db.query(ExtractionCandidate)
            .filter(ExtractionCandidate.gift_card_id == image.gift_card_id)
            .count()
        )

        return {
            "card_image_id": image.id,
            "gift_card_id": image.gift_card_id,
            "ocr_status": gift_card.ocr_status if gift_card else None,
            "processed_image_url": image.processed_image_url,
            "canonical_rotation_degrees": image.canonical_rotation_degrees,
            "orientation_source": image.orientation_source,
            "canonical_transform_metadata": image.canonical_transform_metadata,
            "latest_attempt_id": latest_attempt.id if latest_attempt else None,
            "latest_attempt_created_at": latest_attempt.created_at if latest_attempt else None,
            "candidate_count": candidate_count,
            "worker_max_concurrency": OCR_WORKER_MAX_CONCURRENCY,
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
        payload_zone = {
            "zone_name": payload.zone_name,
            "zone_type": payload.zone_type,
            "x_pct": payload.x_pct,
            "y_pct": payload.y_pct,
            "width_pct": payload.width_pct,
            "height_pct": payload.height_pct,
            "priority": 1,
            "expected_pattern": payload.expected_pattern or "",
            "expected_length": payload.expected_length,
        }
        boundary_zone = payload.card_boundary if isinstance(payload.card_boundary, dict) else None
        image_space_zone = zone_to_image_space(payload_zone, boundary_zone)
        coordinate_mode = (
            "card_boundary_relative"
            if boundary_zone and payload.zone_type != "card_boundary"
            else "full_image_relative"
        )
        transform_chain = (
            "original -> stored canonical OCR image -> card-boundary-relative OCR crop"
            if coordinate_mode == "card_boundary_relative"
            else "original -> stored canonical OCR image -> OCR crop"
        )
        debug_run = OCRDebugRun(enabled=True, max_files=ocr_debug_max_files_from_env())
        region_result = extract_region_ocr_result(
            str(physical_upload_path(image_path) or Path(image_path)),
            x_pct=image_space_zone["x_pct"],
            y_pct=image_space_zone["y_pct"],
            width_pct=image_space_zone["width_pct"],
            height_pct=image_space_zone["height_pct"],
            rotation_degrees=rotation_degrees,
            horizontal_padding_pct=0.10,
            vertical_padding_pct=0.20,
            debug_run=debug_run,
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

        if payload.zone_type == "barcode":
            zone_payload = {
                "zone_name": payload.zone_name,
                "x_pct": image_space_zone["x_pct"],
                "y_pct": image_space_zone["y_pct"],
                "width_pct": image_space_zone["width_pct"],
                "height_pct": image_space_zone["height_pct"],
            }
            barcode_attempts, accepted_values, barcode_debug_paths = (
                collect_barcode_zone_attempts(
                    image_path=image_path,
                    brand=brand,
                    zone=zone_payload,
                    source="barcode_zone",
                    debug_run=debug_run,
                )
            )
            combined_text = "\n\nBARCODE_CANDIDATES:\n" + "\n".join(accepted_values)
            combined_text += format_barcode_attempts(
                [
                    {
                        "source": attempt.get("source"),
                        "rotation_degrees": attempt.get("rotation"),
                        "detected": bool(attempt.get("decoded_value")),
                        "barcode_type": attempt.get("barcode_type"),
                        "decoded_value": attempt.get("decoded_value"),
                        "normalized_candidate": attempt.get("normalized_candidate"),
                        "accepted": attempt.get("accepted"),
                        "reason": attempt.get("rejected_reason")
                        or ("accepted" if attempt.get("accepted") else ""),
                    }
                    for attempt in barcode_attempts
                ]
            )
            candidates = build_extraction_candidates(
                combined_text,
                brand=brand,
                rules=rules,
            )
            useful_candidates = [
                candidate for candidate in candidates if candidate.candidate_type != "rejected"
            ]
            best_candidate = useful_candidates[0] if useful_candidates else None
            parsing_duration_ms = round((time.monotonic() - parsing_started_at) * 1000)
            return {
                "image_source": image_source,
                "rotation_degrees": rotation_degrees,
                "coordinate_mode": coordinate_mode,
                "card_boundary": boundary_zone,
                "image_space_zone": image_space_zone,
                "transform_chain": (
                    "stored Review/OCR image -> card-boundary-relative barcode zone crop -> barcode decoder"
                    if coordinate_mode == "card_boundary_relative"
                    else "stored Review/OCR image -> barcode zone crop -> barcode decoder"
                ),
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
                    "image_x_pct": image_space_zone["x_pct"],
                    "image_y_pct": image_space_zone["y_pct"],
                    "image_width_pct": image_space_zone["width_pct"],
                    "image_height_pct": image_space_zone["height_pct"],
                },
                "crop": {
                    "x_pct": payload.x_pct,
                    "y_pct": payload.y_pct,
                    "width_pct": payload.width_pct,
                    "height_pct": payload.height_pct,
                    "image_x_pct": image_space_zone["x_pct"],
                    "image_y_pct": image_space_zone["y_pct"],
                    "image_width_pct": image_space_zone["width_pct"],
                    "image_height_pct": image_space_zone["height_pct"],
                    "x_px": region_result.crop_left,
                    "y_px": region_result.crop_top,
                    "width_px": region_result.crop_width,
                    "height_px": region_result.crop_height,
                },
                "selected_crop_image_data_url": region_result.selected_crop_data_url,
                "crop_image_data_url": region_result.crop_data_url,
                "debug_image_paths": [
                    *region_result.debug_image_paths,
                    *barcode_debug_paths,
                ],
                "timed_out": False,
                "timing_ms": crop_duration_ms + parsing_duration_ms,
                "stage_timings": [
                    *region_result.stage_timings,
                    {
                        "stage": "barcode_decoding",
                        "duration_ms": parsing_duration_ms,
                        "attempt_count": len(barcode_attempts),
                        "accepted_count": len(accepted_values),
                    },
                ],
                "ocr_passes": [],
                "barcode_attempts": barcode_attempts,
                "raw_text": combined_text,
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
            "coordinate_mode": coordinate_mode,
            "card_boundary": boundary_zone,
            "image_space_zone": image_space_zone,
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
                "image_x_pct": image_space_zone["x_pct"],
                "image_y_pct": image_space_zone["y_pct"],
                "image_width_pct": image_space_zone["width_pct"],
                "image_height_pct": image_space_zone["height_pct"],
            },
            "crop": {
                "x_pct": payload.x_pct,
                "y_pct": payload.y_pct,
                "width_pct": payload.width_pct,
                "height_pct": payload.height_pct,
                "image_x_pct": image_space_zone["x_pct"],
                "image_y_pct": image_space_zone["y_pct"],
                "image_width_pct": image_space_zone["width_pct"],
                "image_height_pct": image_space_zone["height_pct"],
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
            "barcode_attempts": [],
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


@router.post("/{card_image_id}/set-ocr-orientation")
def set_card_image_ocr_orientation(
    card_image_id: int,
    rotation_degrees: int = 0,
    source_image: str = "auto",
):
    db: Session = SessionLocal()

    try:
        ensure_card_image_columns(db)
        image = db.query(CardImage).filter(CardImage.id == card_image_id).first()

        if not image:
            raise HTTPException(status_code=404, detail="Card image not found")

        normalized_rotation = rotation_degrees % 360
        use_saved_source = (
            source_image in {"saved_review_ocr", "processed"}
            and bool(image.processed_image_url)
        )
        source_path = image.processed_image_url if use_saved_source else image.original_image_url
        try:
            canonical_path, canonical_dimensions = save_rotated_canonical_image(
                str(physical_upload_path(source_path) or Path(source_path)),
                UPLOAD_DIR,
                rotation_degrees=normalized_rotation,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Unable to save OCR orientation: {exc}",
            ) from exc

        canonical_file = Path(canonical_path)
        stored_canonical = storage.save(
            object_key=object_key_for("card-images", canonical_file.name),
            data=canonical_file.read_bytes(),
            original_filename=canonical_file.name,
            content_type="image/jpeg",
        )
        canonical_reference = storage.generate_view_url(stored_canonical.object_key)
        canonical_metadata = {
            "selected_rotation": normalized_rotation,
            "rotation_degrees": normalized_rotation,
            "orientation_source": "manual",
            "orientation_score": "manual",
            "tested_rotations": [],
            "reason_selected": "User saved the visible rotated image as OCR orientation.",
            "coordinate_space": "saved_review_ocr_image_percent",
            "canonical_image_source": "manual_visible_rotation",
            "saved_review_ocr_source_path": source_path,
            "saved_review_ocr_source_kind": "saved_review_ocr_image"
            if use_saved_source
            else "original_upload",
            "saved_review_ocr_applied_rotation": normalized_rotation,
            "saved_review_ocr_image": canonical_reference,
            "saved_review_ocr_width": canonical_dimensions["width"],
            "saved_review_ocr_height": canonical_dimensions["height"],
            "display_image_source": "saved_review_ocr_image",
            "ocr_image_source": "saved_review_ocr_image",
            "barcode_image_source": "saved_review_ocr_image",
        }
        image.processed_image_url = canonical_reference
        image.canonical_rotation_degrees = normalized_rotation
        image.orientation_source = "manual"
        image.canonical_transform_metadata = json.dumps(canonical_metadata, default=str)

        gift_card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
        if gift_card:
            clear_gift_card_ocr_artifacts(db, image.gift_card_id)
            gift_card.ocr_status = OCR_STATE_CANONICAL_READY
        record_attachment(
            db,
            owner_type="card_image",
            owner_id=image.id,
            attachment_type="processed_ocr_image",
            stored=stored_canonical,
            retention_until=image.retention_until,
        )

        db.commit()
        db.refresh(image)

        return {
            "id": image.id,
            "gift_card_id": image.gift_card_id,
            "original_image_url": image.original_image_url,
            "processed_image_url": image.processed_image_url,
            "canonical_rotation_degrees": image.canonical_rotation_degrees,
            "orientation_source": image.orientation_source,
            "canonical_transform_metadata": image.canonical_transform_metadata,
            "ocr_status": OCR_STATE_CANONICAL_READY,
            "message": "OCR orientation saved. Re-run OCR when ready.",
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
            gift_card.ocr_status = OCR_STATE_QUEUED
            db.commit()

        queue_card_image_extraction(
            image.id,
            rotation_degrees=rotation_degrees,
        )

        return {
            "gift_card_id": image.gift_card_id,
            "ocr_status": OCR_STATE_QUEUED,
            "message": "OCR queued.",
        }

    finally:
        db.close()
