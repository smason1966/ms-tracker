from pathlib import Path

import cv2
from pyzbar.pyzbar import decode


def decode_barcodes(image_path: str) -> list[str]:
    path = Path(image_path)

    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    image = cv2.imread(str(path))

    if image is None:
        raise ValueError(f"Unable to read image: {image_path}")

    barcodes = decode(image)

    results: list[str] = []

    for barcode in barcodes:
        try:
            value = barcode.data.decode("utf-8").strip()

            if value and value not in results:
                results.append(value)

        except Exception:
            continue

    return results