from pathlib import Path

import cv2
try:
    from pyzbar.pyzbar import decode
except ImportError:  # pragma: no cover - zbar may be absent in lightweight test envs
    decode = None


def decode_barcodes(image_path: str, rotation_degrees: int = 0) -> list[str]:
    return [
        detail["decoded_value"]
        for detail in decode_barcode_details(
            image_path,
            rotation_degrees=rotation_degrees,
        )
    ]


def decode_barcode_details(image_path: str, rotation_degrees: int = 0) -> list[dict]:
    path = Path(image_path)

    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    image = cv2.imread(str(path))

    if image is None:
        raise ValueError(f"Unable to read image: {image_path}")

    normalized_rotation = rotation_degrees % 360

    if normalized_rotation == 90:
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    elif normalized_rotation == 180:
        image = cv2.rotate(image, cv2.ROTATE_180)
    elif normalized_rotation == 270:
        image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)

    if decode is None:
        return []

    barcodes = decode(image)

    results: list[dict] = []
    seen_values: set[str] = set()

    for barcode in barcodes:
        try:
            value = barcode.data.decode("utf-8").strip()

            if value and value not in seen_values:
                seen_values.add(value)
                rect = barcode.rect
                results.append(
                    {
                        "decoded_value": value,
                        "barcode_length": len(value),
                        "barcode_type": str(barcode.type),
                        "x": int(rect.left),
                        "y": int(rect.top),
                        "width": int(rect.width),
                        "height": int(rect.height),
                    }
                )

        except Exception:
            continue

    return results
