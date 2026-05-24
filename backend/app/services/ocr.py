from dataclasses import dataclass
from pathlib import Path
import base64
from concurrent.futures import ThreadPoolExecutor, TimeoutError, as_completed
import io
import logging
import time
from uuid import uuid4

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pytesseract import Output

logger = logging.getLogger(__name__)
OCR_DEBUG_DIR = Path("uploads/ocr-debug")


@dataclass
class OCRToken:
    text: str
    left: int
    top: int
    width: int
    height: int
    line_num: int


@dataclass
class OCRRegionResult:
    text: str
    tokens: list[OCRToken]
    pass_results: list[dict]
    image_width: int
    image_height: int
    selected_left: int
    selected_top: int
    selected_width: int
    selected_height: int
    crop_left: int
    crop_top: int
    crop_width: int
    crop_height: int
    selected_crop_data_url: str
    crop_data_url: str
    debug_image_paths: list[str]
    timed_out: bool
    timing_ms: int
    stage_timings: list[dict]


def extract_text_from_image(image_path: str, rotation_degrees: int = 0) -> str:
    path = Path(image_path)

    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    with Image.open(path) as image:
        if rotation_degrees % 360:
            image = image.rotate(-rotation_degrees, expand=True)

        return pytesseract.image_to_string(image)


def extract_text_and_tokens(
    image_path: str,
    rotation_degrees: int = 0,
) -> tuple[str, list[OCRToken]]:
    path = Path(image_path)

    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    with Image.open(path) as image:
        if rotation_degrees % 360:
            image = image.rotate(-rotation_degrees, expand=True)

        text = pytesseract.image_to_string(image)
        data = pytesseract.image_to_data(image, output_type=Output.DICT)

    tokens: list[OCRToken] = []
    total_items = len(data.get("text", []))

    for index in range(total_items):
        token_text = (data["text"][index] or "").strip()

        if not token_text:
            continue

        try:
            confidence = float(data.get("conf", ["-1"])[index])
        except (TypeError, ValueError):
            confidence = -1

        if confidence < 0:
            continue

        tokens.append(
            OCRToken(
                text=token_text,
                left=int(data["left"][index]),
                top=int(data["top"][index]),
                width=int(data["width"][index]),
                height=int(data["height"][index]),
                line_num=int(data.get("line_num", [0])[index]),
            )
        )

    return text, tokens


def extract_text_and_tokens_from_region(
    image_path: str,
    *,
    x_pct: float,
    y_pct: float,
    width_pct: float,
    height_pct: float,
    rotation_degrees: int = 0,
) -> tuple[str, list[OCRToken]]:
    result = extract_region_ocr_result(
        image_path,
        x_pct=x_pct,
        y_pct=y_pct,
        width_pct=width_pct,
        height_pct=height_pct,
        rotation_degrees=rotation_degrees,
    )

    return result.text, result.tokens


def extract_region_ocr_result(
    image_path: str,
    *,
    x_pct: float,
    y_pct: float,
    width_pct: float,
    height_pct: float,
    rotation_degrees: int = 0,
    horizontal_padding_pct: float = 0,
    vertical_padding_pct: float = 0,
) -> OCRRegionResult:
    path = Path(image_path)

    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    with Image.open(path) as image:
        if rotation_degrees % 360:
            image = image.rotate(-rotation_degrees, expand=True)

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
            return OCRRegionResult(
                text="",
                tokens=[],
                pass_results=[],
                image_width=image_width,
                image_height=image_height,
                selected_left=selected_left,
                selected_top=selected_top,
                selected_width=0,
                selected_height=0,
                crop_left=left,
                crop_top=top,
                crop_width=0,
                crop_height=0,
                selected_crop_data_url="",
                crop_data_url="",
                debug_image_paths=[],
                timed_out=False,
                timing_ms=0,
                stage_timings=[],
            )

        started_at = time.monotonic()
        stage_timings: list[dict] = []
        crop_started_at = time.monotonic()
        selected_crop = image.crop(
            (selected_left, selected_top, selected_right, selected_bottom)
        )
        cropped = image.crop((left, top, right, bottom))
        stage_timings.append(
            {
                "stage": "crop_generation",
                "duration_ms": round((time.monotonic() - crop_started_at) * 1000),
            }
        )
        selected_crop_buffer = io.BytesIO()
        selected_crop.save(selected_crop_buffer, format="PNG")
        selected_crop_data_url = (
            "data:image/png;base64,"
            + base64.b64encode(selected_crop_buffer.getvalue()).decode("ascii")
        )
        crop_buffer = io.BytesIO()
        cropped.save(crop_buffer, format="PNG")
        crop_data_url = (
            "data:image/png;base64,"
            + base64.b64encode(crop_buffer.getvalue()).decode("ascii")
        )
        debug_prefix = uuid4().hex
        debug_started_at = time.monotonic()
        debug_image_paths = save_region_debug_images(
            selected_crop=selected_crop,
            padded_crop=cropped,
            prefix=debug_prefix,
        )
        stage_timings.append(
            {
                "stage": "debug_image_write",
                "duration_ms": round((time.monotonic() - debug_started_at) * 1000),
            }
        )
        selected_results, selected_timed_out, selected_timings = run_region_ocr_passes(
            selected_crop,
            crop_label="selected_baseline",
            debug_prefix=debug_prefix,
            total_timeout_seconds=3.0,
            baseline_only=True,
        )
        padded_results, padded_timed_out, padded_timings = run_region_ocr_passes(
            cropped,
            crop_label="padded",
            debug_prefix=debug_prefix,
            total_timeout_seconds=6.5,
        )
        pass_results = [*selected_results, *padded_results]
        stage_timings.extend(selected_timings)
        stage_timings.extend(padded_timings)
        timed_out = selected_timed_out or padded_timed_out
        total_timing_ms = round((time.monotonic() - started_at) * 1000)
        text = "\n".join(
            f"OCR_PASS|{result['pass_name']}\n{result['text'].strip() or 'NO_TEXT'}"
            for result in pass_results
        )
        best_pass = max(pass_results, key=lambda result: result["score"], default=None)
        data = best_pass["data"] if best_pass else {"text": []}

    tokens: list[OCRToken] = []
    total_items = len(data.get("text", []))

    for index in range(total_items):
        token_text = (data["text"][index] or "").strip()

        if not token_text:
            continue

        try:
            confidence = float(data.get("conf", ["-1"])[index])
        except (TypeError, ValueError):
            confidence = -1

        if confidence < 0:
            continue

        tokens.append(
            OCRToken(
                text=token_text,
                left=left + int(data["left"][index]),
                top=top + int(data["top"][index]),
                width=int(data["width"][index]),
                height=int(data["height"][index]),
                line_num=int(data.get("line_num", [0])[index]),
            )
        )

    return OCRRegionResult(
        text=text,
        tokens=tokens,
        pass_results=[
            {
                "pass_name": result["pass_name"],
                "text": result["text"],
                "score": result["score"],
                "engine_called": result["engine_called"],
                "error": result["error"],
                "timed_out": result["timed_out"],
                "duration_ms": result["duration_ms"],
                "language": result["language"],
                "config": result["config"],
                "psm": result["psm"],
                "oem": result["oem"],
                "image_mode": result["image_mode"],
                "image_width": result["image_width"],
                "image_height": result["image_height"],
                "debug_image_path": result["debug_image_path"],
                "raw_tokens": result["raw_tokens"],
            }
            for result in pass_results
        ],
        image_width=image_width,
        image_height=image_height,
        selected_left=selected_left,
        selected_top=selected_top,
        selected_width=selected_right - selected_left,
        selected_height=selected_bottom - selected_top,
        crop_left=left,
        crop_top=top,
        crop_width=right - left,
        crop_height=bottom - top,
        selected_crop_data_url=selected_crop_data_url,
        crop_data_url=crop_data_url,
        debug_image_paths=debug_image_paths,
        timed_out=timed_out,
        timing_ms=total_timing_ms,
        stage_timings=stage_timings,
    )


def data_url_for_image(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def upscale(image: Image.Image, factor: int) -> Image.Image:
    target_width = max(1, image.width * factor)
    target_height = max(1, image.height * factor)
    max_dimension = 2400

    if max(target_width, target_height) > max_dimension:
        scale = max_dimension / max(target_width, target_height)
        target_width = max(1, int(target_width * scale))
        target_height = max(1, int(target_height * scale))

    return image.resize((target_width, target_height), Image.Resampling.LANCZOS)


def region_ocr_variants(image: Image.Image) -> list[tuple[str, Image.Image]]:
    rgb = image.convert("RGB")
    grayscale = ImageOps.grayscale(rgb)
    red_channel, _, _ = rgb.split()
    enhanced_gray = ImageEnhance.Contrast(ImageOps.autocontrast(grayscale)).enhance(2.2)
    sharpened = enhanced_gray.filter(ImageFilter.SHARPEN).filter(ImageFilter.SHARPEN)
    thresholded = enhanced_gray.point(lambda pixel: 255 if pixel > 145 else 0)
    saturation_reduced = ImageEnhance.Color(rgb).enhance(0.05).convert("L")
    saturation_reduced = ImageEnhance.Contrast(
        ImageOps.autocontrast(saturation_reduced)
    ).enhance(2.4)
    red_isolated = ImageEnhance.Contrast(ImageOps.autocontrast(red_channel)).enhance(2.6)
    red_suppressed = suppress_red_orange_background(rgb)
    adaptive = adaptive_threshold(rgb)

    return [
        ("original_2x", upscale(rgb, 2)),
        ("original_4x", upscale(rgb, 4)),
        ("grayscale_contrast_3x", upscale(enhanced_gray, 3)),
        ("sharpened_3x", upscale(sharpened, 3)),
        ("thresholded_3x", upscale(thresholded, 3)),
        ("saturation_reduced_3x", upscale(saturation_reduced, 3)),
        ("red_channel_3x", upscale(red_isolated, 3)),
        ("red_orange_suppressed_4x", upscale(red_suppressed, 4)),
        ("adaptive_threshold_4x", upscale(adaptive, 4)),
    ]


def run_region_ocr_passes(
    image: Image.Image,
    *,
    crop_label: str,
    debug_prefix: str,
    total_timeout_seconds: float,
    baseline_only: bool = False,
) -> tuple[list[dict], bool, list[dict]]:
    OCR_DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    batch_started_at = time.monotonic()
    base_config = "--oem 3 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    ocr_modes = [("single_line", "--psm 7"), ("block", "--psm 6"), ("raw_line", "--psm 13")]
    results: list[dict] = []
    stage_timings: list[dict] = []
    timed_out = False
    preprocessing_started_at = time.monotonic()
    variants = region_ocr_variants(image)

    if baseline_only:
        variants = variants[:1]

    stage_timings.append(
        {
            "stage": f"{crop_label}_preprocessing",
            "duration_ms": round((time.monotonic() - preprocessing_started_at) * 1000),
            "pass_count": len(variants) * len(ocr_modes),
        }
    )
    tasks = []

    for pass_name, variant in variants:
        for mode_name, mode_config in ocr_modes:
            tasks.append((pass_name, variant, mode_name, mode_config))

    executor = ThreadPoolExecutor(max_workers=min(4, max(1, len(tasks))))
    futures = [
        executor.submit(
            run_single_ocr_pass,
            variant,
            crop_label=crop_label,
            pass_name=pass_name,
            mode_name=mode_name,
            mode_config=mode_config,
            base_config=base_config,
            debug_prefix=debug_prefix,
        )
        for pass_name, variant, mode_name, mode_config in tasks
    ]

    try:
        for future in as_completed(futures, timeout=total_timeout_seconds):
            result = future.result()
            results.append(result)
            stage_timings.append(
                {
                    "stage": f"ocr_pass_{result['pass_name']}",
                    "duration_ms": result["duration_ms"],
                    "timed_out": result["timed_out"],
                }
            )
    except TimeoutError:
        timed_out = True
        logger.warning(
            "OCR batch timed out",
            extra={
                "crop_label": crop_label,
                "timeout_seconds": total_timeout_seconds,
                "completed": len(results),
                "scheduled": len(tasks),
            },
        )
        for future in futures:
            future.cancel()
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    stage_timings.append(
        {
            "stage": f"{crop_label}_ocr_batch",
            "duration_ms": round((time.monotonic() - batch_started_at) * 1000),
            "timed_out": timed_out,
            "completed_passes": len(results),
            "scheduled_passes": len(tasks),
        }
    )

    return results, timed_out, stage_timings


def run_single_ocr_pass(
    variant: Image.Image,
    *,
    crop_label: str,
    pass_name: str,
    mode_name: str,
    mode_config: str,
    base_config: str,
    debug_prefix: str,
) -> dict:
    started_at = time.monotonic()
    config = f"{mode_config} {base_config}"
    debug_path = OCR_DEBUG_DIR / f"{debug_prefix}-{crop_label}-{pass_name}-{mode_name}.png"
    variant.save(debug_path)
    logger.info(
        "OCR pass started",
        extra={
            "crop_label": crop_label,
            "pass_name": pass_name,
            "mode_name": mode_name,
            "config": config,
            "language": "eng",
            "image_mode": variant.mode,
            "image_width": variant.width,
            "image_height": variant.height,
            "debug_path": str(debug_path),
        },
    )

    try:
        data = pytesseract.image_to_data(
            variant,
            lang="eng",
            config=config,
            output_type=Output.DICT,
            timeout=2.0,
        )
        text = " ".join(
            (value or "").strip()
            for value in data.get("text", [])
            if (value or "").strip()
        )
        engine_called = True
        timed_out = False
        error = None
    except RuntimeError as exc:
        text = ""
        data = {"text": []}
        engine_called = True
        timed_out = "timeout" in str(exc).lower()
        error = str(exc)
    except Exception as exc:
        logger.exception("OCR pass failed")
        text = ""
        data = {"text": []}
        engine_called = False
        timed_out = False
        error = str(exc)

    raw_tokens = [
        {
            "text": (data.get("text", [""])[index] or "").strip(),
            "conf": data.get("conf", [""])[index],
            "left": data.get("left", [0])[index],
            "top": data.get("top", [0])[index],
            "width": data.get("width", [0])[index],
            "height": data.get("height", [0])[index],
        }
        for index in range(len(data.get("text", [])))
        if (data.get("text", [""])[index] or "").strip()
    ]
    normalized_text = "".join(
        character for character in text.upper() if character.isalnum()
    )
    score = len(normalized_text)

    if "NAAW" in normalized_text or "NAAD" in normalized_text:
        score += 20

    if len(normalized_text) >= 12:
        score += 8

    duration_ms = round((time.monotonic() - started_at) * 1000)
    logger.info(
        "OCR pass completed",
        extra={
            "crop_label": crop_label,
            "pass_name": pass_name,
            "mode_name": mode_name,
            "duration_ms": duration_ms,
            "timed_out": timed_out,
            "text": text,
            "token_count": len(raw_tokens),
        },
    )

    return {
        "pass_name": f"{crop_label}:{pass_name}:{mode_name}",
        "text": text,
        "data": data,
        "score": score,
        "engine_called": engine_called,
        "error": error,
        "timed_out": timed_out,
        "duration_ms": duration_ms,
        "language": "eng",
        "config": config,
        "psm": mode_config.replace("--psm ", ""),
        "oem": "3",
        "image_mode": variant.mode,
        "image_width": variant.width,
        "image_height": variant.height,
        "debug_image_path": str(debug_path),
        "raw_tokens": raw_tokens[:20],
    }


def save_region_debug_images(
    *,
    selected_crop: Image.Image,
    padded_crop: Image.Image,
    prefix: str,
) -> list[str]:
    OCR_DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    paths = [
        OCR_DEBUG_DIR / f"{prefix}-selected-crop.png",
        OCR_DEBUG_DIR / f"{prefix}-padded-crop.png",
    ]
    selected_crop.save(paths[0])
    padded_crop.save(paths[1])
    return [str(path) for path in paths]


def suppress_red_orange_background(image: Image.Image) -> Image.Image:
    rgb = np.array(image.convert("RGB"))
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)
    luminance = (0.299 * red + 0.587 * green + 0.114 * blue).astype(np.uint8)

    red_orange_background = (red > 95) & (red > green + 20) & (green > blue + 8)
    dark_text = luminance < 115
    output = np.full(luminance.shape, 255, dtype=np.uint8)
    output[dark_text & ~red_orange_background] = 0

    return Image.fromarray(output, mode="L").filter(ImageFilter.SHARPEN)


def adaptive_threshold(image: Image.Image) -> Image.Image:
    grayscale = np.array(ImageOps.grayscale(image.convert("RGB")))
    grayscale = cv2.GaussianBlur(grayscale, (3, 3), 0)
    thresholded = cv2.adaptiveThreshold(
        grayscale,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        9,
    )

    return Image.fromarray(thresholded, mode="L").filter(ImageFilter.SHARPEN)
