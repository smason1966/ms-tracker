from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageOps
try:
    from pyzbar.pyzbar import decode
except ImportError:  # pragma: no cover - zbar may be absent in lightweight test envs
    decode = None


@dataclass
class CanonicalOrientationResult:
    image: np.ndarray
    method: str
    rotation_degrees: int
    orientation_source: str
    score: float
    tested_rotations: list[dict]
    reason_selected: str


def order_points(points: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    point_sums = points.sum(axis=1)
    point_diffs = np.diff(points, axis=1)

    rect[0] = points[np.argmin(point_sums)]
    rect[2] = points[np.argmax(point_sums)]
    rect[1] = points[np.argmin(point_diffs)]
    rect[3] = points[np.argmax(point_diffs)]

    return rect


def four_point_transform(image: np.ndarray, points: np.ndarray) -> np.ndarray:
    rect = order_points(points)
    top_left, top_right, bottom_right, bottom_left = rect

    width_a = np.linalg.norm(bottom_right - bottom_left)
    width_b = np.linalg.norm(top_right - top_left)
    max_width = max(int(width_a), int(width_b))

    height_a = np.linalg.norm(top_right - bottom_right)
    height_b = np.linalg.norm(top_left - bottom_left)
    max_height = max(int(height_a), int(height_b))

    if max_width <= 0 or max_height <= 0:
        return image

    destination = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, destination)

    return cv2.warpPerspective(image, matrix, (max_width, max_height))


def find_card_contour(image: np.ndarray) -> np.ndarray | None:
    height, width = image.shape[:2]
    scale = 900 / max(width, height) if max(width, height) > 900 else 1
    resized = cv2.resize(image, (int(width * scale), int(height * scale)))
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 45, 140)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edged = cv2.morphologyEx(edged, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(
        edged,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    image_area = resized.shape[0] * resized.shape[1]

    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        area = cv2.contourArea(contour)

        if area < image_area * 0.2:
            continue

        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)

        if len(approx) != 4:
            continue

        points = approx.reshape(4, 2).astype("float32") / scale
        rect = order_points(points)
        width_estimate = max(
            np.linalg.norm(rect[2] - rect[3]),
            np.linalg.norm(rect[1] - rect[0]),
        )
        height_estimate = max(
            np.linalg.norm(rect[1] - rect[2]),
            np.linalg.norm(rect[0] - rect[3]),
        )

        if width_estimate <= 0 or height_estimate <= 0:
            continue

        aspect_ratio = max(width_estimate, height_estimate) / min(
            width_estimate,
            height_estimate,
        )

        if 1.15 <= aspect_ratio <= 2.8:
            return points

    return None


def normalize_for_ocr(image: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, channel_a, channel_b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.4, tileGridSize=(8, 8))
    enhanced_lightness = clahe.apply(lightness)
    enhanced = cv2.merge((enhanced_lightness, channel_a, channel_b))
    enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)

    gaussian = cv2.GaussianBlur(enhanced, (0, 0), 1.0)
    sharpened = cv2.addWeighted(enhanced, 1.18, gaussian, -0.18, 0)

    return sharpened


def resize_for_orientation_scoring(
    image: np.ndarray,
    max_dimension: int = 1000,
) -> np.ndarray:
    height, width = image.shape[:2]
    largest_dimension = max(height, width)
    if largest_dimension <= max_dimension:
        return image

    scale = max_dimension / largest_dimension
    return cv2.resize(
        image,
        (max(1, int(width * scale)), max(1, int(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def preprocess_card_image(original_image_path: str, output_dir: Path) -> tuple[str, str]:
    return preprocess_card_image_with_rotation(
        original_image_path,
        output_dir,
        rotation_degrees=0,
    )


def rotate_image_for_ocr(image: np.ndarray, rotation_degrees: int) -> np.ndarray:
    normalized_rotation = rotation_degrees % 360

    if normalized_rotation == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if normalized_rotation == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    if normalized_rotation == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)

    return image


def read_image_respecting_exif(image_path: str) -> np.ndarray | None:
    try:
        with Image.open(image_path) as pil_image:
            pil_image = ImageOps.exif_transpose(pil_image).convert("RGB")
            rgb_image = np.array(pil_image)
            return cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
    except Exception:
        return cv2.imread(image_path)


def decoded_barcode_values(image: np.ndarray) -> list[str]:
    values: list[str] = []
    if decode is None:
        return values

    try:
        for barcode in decode(image):
            try:
                value = barcode.data.decode("utf-8").strip()
            except Exception:
                continue

            if value and value not in values:
                values.append(value)
    except Exception:
        return []

    return values


def decoded_barcode_details_from_image(image: np.ndarray) -> list[dict]:
    details: list[dict] = []
    if decode is None:
        return details

    try:
        for barcode in decode(image):
            try:
                value = barcode.data.decode("utf-8").strip()
            except Exception:
                continue

            if not value:
                continue

            rect = barcode.rect
            details.append(
                {
                    "decoded_value": value,
                    "x": int(rect.left),
                    "y": int(rect.top),
                    "width": int(rect.width),
                    "height": int(rect.height),
                }
            )
    except Exception:
        return []

    return details


def ocr_orientation_data(image: np.ndarray) -> dict:
    try:
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_image)
        text = pytesseract.image_to_string(
            pil_image,
            config="--psm 6",
            timeout=4,
        ).upper()
        data = pytesseract.image_to_data(
            pil_image,
            config="--psm 6",
            output_type=pytesseract.Output.DICT,
            timeout=4,
        )
    except Exception:
        return {
            "text": "",
            "confidence": 0.0,
            "readable_token_count": 0,
            "numeric_runs": [],
            "tokens": [],
        }

    tokens: list[str] = []
    confidences: list[float] = []
    for raw_text, raw_confidence in zip(data.get("text", []), data.get("conf", [])):
        token = str(raw_text or "").strip()
        if not token:
            continue
        try:
            confidence = float(raw_confidence)
        except (TypeError, ValueError):
            continue
        if confidence <= 0:
            continue
        tokens.append(token.upper())
        confidences.append(confidence)

    useful_confidences = [value for value in confidences if value > 0]
    if not useful_confidences:
        confidence = 0.0
    else:
        confidence = max(
            0.0,
            min(sum(useful_confidences) / len(useful_confidences), 100.0),
        )

    readable_tokens = [
        token
        for token, confidence_value in zip(tokens, confidences)
        if confidence_value >= 35 and re.search(r"[A-Z0-9]", token)
    ]

    return {
        "text": text,
        "confidence": confidence,
        "readable_token_count": len(readable_tokens),
        "numeric_runs": re.findall(r"\d[\d\s-]{10,}\d", text),
        "tokens": readable_tokens,
    }


def ocr_orientation_text(image: np.ndarray) -> str:
    return str(ocr_orientation_data(image).get("text") or "")


def ocr_orientation_confidence(image: np.ndarray) -> float:
    return float(ocr_orientation_data(image).get("confidence") or 0.0)


def tesseract_osd_orientation(image: np.ndarray) -> dict:
    try:
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_image)
        osd_text = pytesseract.image_to_osd(pil_image, timeout=2)
    except Exception:
        return {"rotate": None, "confidence": 0.0, "raw": ""}

    rotate_match = re.search(r"Rotate:\s*(\d+)", osd_text)
    confidence_match = re.search(r"Orientation confidence:\s*([0-9.]+)", osd_text)

    return {
        "rotate": int(rotate_match.group(1)) if rotate_match else None,
        "confidence": float(confidence_match.group(1)) if confidence_match else 0.0,
        "raw": osd_text.strip(),
    }


def parse_template_layouts(ocr_zones: str | None) -> list[dict]:
    if not ocr_zones:
        return []

    try:
        value = json.loads(ocr_zones)
    except json.JSONDecodeError:
        return []

    if isinstance(value, list):
        return [{"layout_name": "default", "zones": value, "active": True}]

    if not isinstance(value, dict):
        return []

    layouts = value.get("layouts") or value.get("layout_variants") or value.get("variants")
    if isinstance(layouts, list):
        parsed_layouts = []
        for index, layout in enumerate(layouts, start=1):
            if not isinstance(layout, dict) or layout.get("active") is False:
                continue
            zones = layout.get("zones")
            if isinstance(zones, list):
                parsed_layouts.append(
                    {
                        "layout_name": str(
                            layout.get("layout_name")
                            or layout.get("name")
                            or f"layout_{index}"
                        ),
                        "zones": zones,
                        "active": True,
                    }
                )
        return parsed_layouts

    zones = value.get("zones")
    if isinstance(zones, list):
        return [
            {
                "layout_name": str(value.get("layout_name") or value.get("name") or "default"),
                "zones": zones,
                "active": True,
            }
        ]

    return []


def template_fit_score(image: np.ndarray, ocr_zones: str | None) -> tuple[float, str]:
    layouts = parse_template_layouts(ocr_zones)
    if not layouts:
        return 0.0, "no_template"

    height, width = image.shape[:2]
    barcode_details = decoded_barcode_details_from_image(image)
    if not barcode_details:
        return 0.0, "template_no_barcodes"

    best_score = 0.0
    best_layout = "none"
    for layout in layouts:
        layout_score = 0.0
        for zone in layout["zones"]:
            if not isinstance(zone, dict):
                continue
            if str(zone.get("zone_type") or "").strip().lower() != "barcode":
                continue
            try:
                left = float(zone.get("x_pct")) / 100.0 * width
                top = float(zone.get("y_pct")) / 100.0 * height
                right = left + float(zone.get("width_pct")) / 100.0 * width
                bottom = top + float(zone.get("height_pct")) / 100.0 * height
            except (TypeError, ValueError):
                continue

            for detail in barcode_details:
                center_x = detail["x"] + detail["width"] / 2
                center_y = detail["y"] + detail["height"] / 2
                if left <= center_x <= right and top <= center_y <= bottom:
                    layout_score += 1.25

        if layout_score > best_score:
            best_score = layout_score
            best_layout = str(layout["layout_name"])

    return best_score, f"template_fit:{best_layout}" if best_score else "template_no_fit"


def brand_orientation_score(
    image: np.ndarray,
    brand: str | None,
    *,
    ocr_zones: str | None = None,
) -> dict:
    normalized_brand = (brand or "").strip().lower()
    height, width = image.shape[:2]
    human_score = 0.0
    support_score = 0.0
    reasons: list[str] = []

    if width >= height:
        human_score += 0.35
        reasons.append("landscape")

    scoring_image = resize_for_orientation_scoring(image)
    normalized_image = normalize_for_ocr(scoring_image)
    barcode_values = decoded_barcode_values(scoring_image)
    ocr_data = ocr_orientation_data(normalized_image)
    osd_data = tesseract_osd_orientation(normalized_image)
    text = str(ocr_data.get("text") or "")
    ocr_confidence = float(ocr_data.get("confidence") or 0.0)
    readable_token_count = int(ocr_data.get("readable_token_count") or 0)
    numeric_runs = list(ocr_data.get("numeric_runs") or [])
    tokens = list(ocr_data.get("tokens") or [])
    card_number_match = any(len(re.sub(r"\D", "", run)) in {16, 19} for run in numeric_runs)
    pin_match = bool(re.search(r"\bPIN\b[^\d]{0,12}\d{3,8}\b", text))

    if barcode_values:
        support_score += 0.3
        reasons.append(f"{len(barcode_values)} barcode(s)")

    if ocr_confidence:
        human_score += min(1.6, ocr_confidence / 55)
        reasons.append(f"OCR confidence {ocr_confidence:.0f}")

    if readable_token_count:
        human_score += min(2.0, readable_token_count * 0.18)
        reasons.append(f"{readable_token_count} readable OCR token(s)")

    osd_rotate = osd_data.get("rotate")
    osd_confidence = float(osd_data.get("confidence") or 0.0)
    if osd_rotate == 0 and osd_confidence >= 2:
        human_score += min(1.4, 0.35 + osd_confidence / 10)
        reasons.append(f"OSD upright confidence {osd_confidence:.1f}")
    elif osd_rotate in {90, 180, 270} and osd_confidence >= 2:
        human_score -= min(1.2, 0.25 + osd_confidence / 12)
        reasons.append(f"OSD says rotate {osd_rotate}")

    label_tokens = {
        "CARD",
        "NUMBER",
        "PIN",
        "GIFT",
        "REDEEM",
        "REDEMPTION",
        "BALANCE",
        "BEST",
        "BUY",
        "NIKE",
        "DOORDASH",
        "UBER",
    }
    readable_label_count = sum(
        1 for token in tokens if token.strip(":#").upper() in label_tokens
    )
    if readable_label_count:
        human_score += min(2.0, readable_label_count * 0.35)
        reasons.append(f"{readable_label_count} credential/brand label(s)")

    if card_number_match:
        human_score += 1.6
        reasons.append("horizontal card number OCR match")

    if pin_match:
        human_score += 1.0
        reasons.append("horizontal PIN OCR match")

    if "best buy" in normalized_brand:
        if any(value.isdigit() and len(value) == 16 for value in barcode_values):
            support_score += 0.7
            reasons.append("Best Buy 16-digit barcode")
        if card_number_match:
            human_score += 1.0
            reasons.append("Best Buy 16-digit OCR run")
        if "CARD" in text:
            human_score += 0.75
            reasons.append("CARD label readable")
        if "PIN" in text:
            human_score += 0.75
            reasons.append("PIN label readable")
        if "REDEMPTION" in text or "REDEEM" in text:
            human_score += 0.35
            reasons.append("redemption label readable")
    elif "nike" in normalized_brand:
        if any(
            value.isdigit()
            and value.startswith("606010")
            and len(value) in {16, 19}
            for value in barcode_values
        ):
            support_score += 0.7
            reasons.append("Nike redeem barcode prefix/length")
        if card_number_match:
            human_score += 0.8
            reasons.append("Nike card OCR length")
        if "CARD" in text:
            human_score += 0.75
            reasons.append("CARD label readable")
        if "PIN" in text:
            human_score += 0.75
            reasons.append("PIN label readable")
        if "REDEMPTION" in text or "REDEEM" in text:
            human_score += 0.35
            reasons.append("redemption label readable")
    else:
        if any(len(value) >= 12 for value in barcode_values):
            support_score += 0.5
            reasons.append("long barcode")
        if any(label in text for label in ("CARD", "PIN", "GIFT CODE")):
            human_score += 0.75
            reasons.append("credential label readable")

    fit_score, fit_reason = template_fit_score(scoring_image, ocr_zones)
    if fit_score:
        support_score += min(0.6, fit_score * 0.2)
        reasons.append(fit_reason)

    total_score = human_score + support_score
    return {
        "score": total_score,
        "human_score": human_score,
        "support_score": support_score,
        "ocr_confidence": ocr_confidence,
        "readable_token_count": readable_token_count,
        "card_number_match": card_number_match,
        "pin_match": pin_match,
        "barcode_count": len(barcode_values),
        "barcode_values": barcode_values[:5],
        "template_score": fit_score,
        "osd_rotate": osd_rotate,
        "osd_confidence": osd_confidence,
        "reasons": ",".join(reasons) or "no_orientation_evidence",
    }


def normalize_card_orientation(
    image: np.ndarray,
    *,
    brand: str | None = None,
    ocr_zones: str | None = None,
) -> tuple[np.ndarray, str]:
    result = normalize_card_orientation_with_metadata(
        image,
        brand=brand,
        ocr_zones=ocr_zones,
    )
    return result.image, result.method


def normalize_card_orientation_with_metadata(
    image: np.ndarray,
    *,
    brand: str | None = None,
    ocr_zones: str | None = None,
) -> CanonicalOrientationResult:
    candidates: list[dict] = []

    for rotation in (0, 90, 180, 270):
        rotated = rotate_image_for_ocr(image, rotation)
        score_data = brand_orientation_score(
            rotated,
            brand,
            ocr_zones=ocr_zones,
        )
        height, width = rotated.shape[:2]
        candidates.append(
            {
                **score_data,
                "rotation_degrees": rotation,
                "image": rotated,
                "width": int(width),
                "height": int(height),
                "is_landscape": width >= height,
            }
        )

    best_candidate = max(
        candidates,
        key=lambda item: (
            item["human_score"],
            item["score"],
            item["is_landscape"],
            item["card_number_match"],
            item["pin_match"],
            item["ocr_confidence"],
            item["support_score"],
        ),
    )
    best_score = float(best_candidate["score"])
    best_rotation = int(best_candidate["rotation_degrees"])
    best_reasons = str(best_candidate["reasons"])
    best_image = best_candidate["image"]
    reason_selected = (
        "Selected highest human-readable orientation: "
        f"human_score={best_candidate['human_score']:.2f}, "
        f"ocr_confidence={best_candidate['ocr_confidence']:.0f}, "
        f"tokens={best_candidate['readable_token_count']}, "
        f"card_number_match={best_candidate['card_number_match']}, "
        f"pin_match={best_candidate['pin_match']}, "
        f"support_score={best_candidate['support_score']:.2f}."
    )
    tested_rotations = [
        {
            "rotation_degrees": int(candidate["rotation_degrees"]),
            "score": round(float(candidate["score"]), 4),
            "human_score": round(float(candidate["human_score"]), 4),
            "support_score": round(float(candidate["support_score"]), 4),
            "ocr_confidence": round(float(candidate["ocr_confidence"]), 2),
            "readable_token_count": int(candidate["readable_token_count"]),
            "card_number_match": bool(candidate["card_number_match"]),
            "pin_match": bool(candidate["pin_match"]),
            "barcode_count": int(candidate["barcode_count"]),
            "template_score": round(float(candidate["template_score"]), 4),
            "osd_rotate": candidate["osd_rotate"],
            "osd_confidence": round(float(candidate["osd_confidence"]), 2),
            "reasons": str(candidate["reasons"]),
            "width": int(candidate["width"]),
            "height": int(candidate["height"]),
        }
        for candidate in candidates
    ]

    if best_candidate["human_score"] > 0:
        source = "auto"
        method = (
            f"canonical_brand_orientation_{best_rotation}_score_"
            f"{best_score:.2f}_{best_reasons}"
        )
    else:
        height, width = image.shape[:2]

        if height > width:
            best_image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
            best_rotation = 90
            source = "auto"
            method = "canonical_landscape_90"
            best_score = 0.0
            reason_selected = "No readable OCR evidence; forced landscape orientation."
        else:
            best_image = image
            best_rotation = 0
            source = "auto"
            method = "canonical_landscape_0"
            best_score = 0.0
            reason_selected = "No readable OCR evidence; kept existing landscape orientation."

    height, width = best_image.shape[:2]
    if height > width:
        best_image = cv2.rotate(best_image, cv2.ROTATE_90_CLOCKWISE)
        best_rotation = (best_rotation + 90) % 360
        method = f"{method}_forced_landscape_90"
        reason_selected += " Forced final image to landscape."

    return CanonicalOrientationResult(
        image=best_image,
        method=method,
        rotation_degrees=best_rotation % 360,
        orientation_source=source,
        score=best_score,
        tested_rotations=tested_rotations,
        reason_selected=reason_selected,
    )

def preprocess_card_image_with_rotation_metadata(
    original_image_path: str,
    output_dir: Path,
    *,
    rotation_degrees: int = 0,
    brand: str | None = None,
    ocr_zones: str | None = None,
) -> tuple[str, str, dict]:
    image = read_image_respecting_exif(original_image_path)

    if image is None:
        raise ValueError(f"Unable to read image: {original_image_path}")

    image = rotate_image_for_ocr(image, rotation_degrees)
    contour = find_card_contour(image)
    rotation_note = f"manual_rotation_{rotation_degrees % 360}"
    method = f"{rotation_note}_crop_not_applied"
    crop_source = "full_image"

    if contour is not None:
        working_image = four_point_transform(image, contour)
        method = f"{rotation_note}_contour_perspective_corrected"
        crop_source = "contour_perspective"
    else:
        working_image = image

    if min(working_image.shape[:2]) < 200:
        working_image = image
        method = f"{rotation_note}_crop_rejected_too_small"
        crop_source = "full_image"

    orientation = normalize_card_orientation_with_metadata(
        working_image,
        brand=brand,
        ocr_zones=ocr_zones,
    )
    method = f"{method}_{orientation.method}"
    processed = normalize_for_ocr(orientation.image)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"processed-{uuid4().hex}.jpg"

    cv2.imwrite(
        str(output_path),
        processed,
        [int(cv2.IMWRITE_JPEG_QUALITY), 96],
    )

    metadata = {
        "selected_rotation": orientation.rotation_degrees,
        "rotation_degrees": orientation.rotation_degrees,
        "orientation_source": orientation.orientation_source,
        "orientation_score": orientation.score,
        "tested_rotations": orientation.tested_rotations,
        "reason_selected": orientation.reason_selected,
        "crop_source": crop_source,
        "canonical_width": int(processed.shape[1]),
        "canonical_height": int(processed.shape[0]),
        "coordinate_space": "canonical_ocr_image_percent",
    }

    return str(output_path), method, metadata


def preprocess_card_image_with_rotation(
    original_image_path: str,
    output_dir: Path,
    *,
    rotation_degrees: int = 0,
    brand: str | None = None,
    ocr_zones: str | None = None,
) -> tuple[str, str]:
    processed_path, method, _ = preprocess_card_image_with_rotation_metadata(
        original_image_path,
        output_dir,
        rotation_degrees=rotation_degrees,
        brand=brand,
        ocr_zones=ocr_zones,
    )
    return processed_path, method


def save_rotated_canonical_image(
    image_path: str,
    output_dir: Path,
    *,
    rotation_degrees: int,
) -> tuple[str, dict]:
    normalized_rotation = rotation_degrees % 360
    output_dir.mkdir(parents=True, exist_ok=True)

    with Image.open(image_path) as image:
        rotated = ImageOps.exif_transpose(image).rotate(
            -normalized_rotation,
            expand=True,
        )
        if rotated.mode not in {"RGB", "L"}:
            rotated = rotated.convert("RGB")

        output_path = output_dir / f"canonical-{uuid4().hex}.jpg"
        rotated.save(output_path, quality=96)

    return str(output_path), {
        "width": int(rotated.width),
        "height": int(rotated.height),
        "rotation_degrees": normalized_rotation,
    }
