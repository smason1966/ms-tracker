from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageOps
from pyzbar.pyzbar import decode


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


def ocr_orientation_text(image: np.ndarray) -> str:
    try:
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_image)
        return pytesseract.image_to_string(
            pil_image,
            config="--psm 6",
        ).upper()
    except Exception:
        return ""


def ocr_orientation_confidence(image: np.ndarray) -> float:
    try:
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_image)
        data = pytesseract.image_to_data(
            pil_image,
            config="--psm 6",
            output_type=pytesseract.Output.DICT,
        )
        confidences = [
            float(value)
            for value in data.get("conf", [])
            if str(value).strip() not in {"", "-1"}
        ]
    except Exception:
        return 0.0

    useful_confidences = [value for value in confidences if value > 0]
    if not useful_confidences:
        return 0.0

    return max(0.0, min(sum(useful_confidences) / len(useful_confidences), 100.0))


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
) -> tuple[float, str]:
    normalized_brand = (brand or "").strip().lower()
    height, width = image.shape[:2]
    score = 0.0
    reasons: list[str] = []

    if width >= height:
        score += 0.5
        reasons.append("landscape")

    normalized_image = normalize_for_ocr(image)
    barcode_values = decoded_barcode_values(image)
    text = ocr_orientation_text(normalized_image)
    ocr_confidence = ocr_orientation_confidence(normalized_image)

    if barcode_values:
        score += 0.5
        reasons.append(f"{len(barcode_values)} barcode(s)")

    if ocr_confidence:
        score += min(1.2, ocr_confidence / 100)
        reasons.append(f"OCR confidence {ocr_confidence:.0f}")

    if "best buy" in normalized_brand:
        if any(value.isdigit() and len(value) == 16 for value in barcode_values):
            score += 3.0
            reasons.append("Best Buy 16-digit barcode")
        if "CARD" in text:
            score += 1.0
            reasons.append("CARD label readable")
        if "PIN" in text:
            score += 1.0
            reasons.append("PIN label readable")
        if "REDEMPTION" in text or "REDEEM" in text:
            score += 0.5
            reasons.append("redemption label readable")
    elif "nike" in normalized_brand:
        if any(
            value.isdigit()
            and value.startswith("606010")
            and len(value) in {16, 19}
            for value in barcode_values
        ):
            score += 3.0
            reasons.append("Nike redeem barcode prefix/length")
        if "CARD" in text:
            score += 1.0
            reasons.append("CARD label readable")
        if "PIN" in text:
            score += 1.0
            reasons.append("PIN label readable")
        if "REDEMPTION" in text or "REDEEM" in text:
            score += 0.5
            reasons.append("redemption label readable")
    else:
        if any(len(value) >= 12 for value in barcode_values):
            score += 1.0
            reasons.append("long barcode")
        if any(label in text for label in ("CARD", "PIN", "GIFT CODE")):
            score += 1.0
            reasons.append("credential label readable")

    fit_score, fit_reason = template_fit_score(image, ocr_zones)
    if fit_score:
        score += fit_score
        reasons.append(fit_reason)

    return score, ",".join(reasons) or "no_orientation_evidence"


def normalize_card_orientation(
    image: np.ndarray,
    *,
    brand: str | None = None,
    ocr_zones: str | None = None,
) -> tuple[np.ndarray, str]:
    candidates: list[tuple[float, int, str, np.ndarray]] = []

    for rotation in (0, 90, 180, 270):
        rotated = rotate_image_for_ocr(image, rotation)
        score, reasons = brand_orientation_score(
            rotated,
            brand,
            ocr_zones=ocr_zones,
        )
        candidates.append((score, rotation, reasons, rotated))

    best_score, best_rotation, best_reasons, best_image = max(
        candidates,
        key=lambda item: item[0],
    )

    if best_score > 0:
        return (
            best_image,
            f"canonical_brand_orientation_{best_rotation}_score_{best_score:.2f}_{best_reasons}",
        )

    height, width = image.shape[:2]

    if height > width:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE), "canonical_landscape_90"

    return image, "canonical_landscape_0"


def preprocess_card_image_with_rotation(
    original_image_path: str,
    output_dir: Path,
    *,
    rotation_degrees: int = 0,
    brand: str | None = None,
    ocr_zones: str | None = None,
) -> tuple[str, str]:
    image = read_image_respecting_exif(original_image_path)

    if image is None:
        raise ValueError(f"Unable to read image: {original_image_path}")

    image = rotate_image_for_ocr(image, rotation_degrees)
    contour = find_card_contour(image)
    rotation_note = f"manual_rotation_{rotation_degrees % 360}"
    method = f"{rotation_note}_crop_not_applied"

    if contour is not None:
        working_image = four_point_transform(image, contour)
        method = f"{rotation_note}_contour_perspective_corrected"
    else:
        working_image = image

    if min(working_image.shape[:2]) < 200:
        working_image = image
        method = f"{rotation_note}_crop_rejected_too_small"

    working_image, orientation_method = normalize_card_orientation(
        working_image,
        brand=brand,
        ocr_zones=ocr_zones,
    )
    method = f"{method}_{orientation_method}"
    processed = normalize_for_ocr(working_image)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"processed-{uuid4().hex}.jpg"

    cv2.imwrite(
        str(output_path),
        processed,
        [int(cv2.IMWRITE_JPEG_QUALITY), 96],
    )

    return str(output_path), method


def save_rotated_canonical_image(
    image_path: str,
    output_dir: Path,
    *,
    rotation_degrees: int,
) -> str:
    normalized_rotation = rotation_degrees % 360
    output_dir.mkdir(parents=True, exist_ok=True)

    if normalized_rotation == 0:
        return image_path

    with Image.open(image_path) as image:
        rotated = ImageOps.exif_transpose(image).rotate(
            -normalized_rotation,
            expand=True,
        )
        if rotated.mode not in {"RGB", "L"}:
            rotated = rotated.convert("RGB")

        output_path = output_dir / f"canonical-{uuid4().hex}.jpg"
        rotated.save(output_path, quality=96)

    return str(output_path)
