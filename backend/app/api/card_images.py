from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card_image import CardImage
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_candidate import ExtractionCandidate
from app.services.barcode import decode_barcodes
from app.services.card_parser import parse_card_data
from app.services.extraction_candidates import build_extraction_candidates
from app.services.ocr import extract_text_from_image

router = APIRouter(prefix="/card-images", tags=["card-images"])

UPLOAD_DIR = Path("uploads/card-images")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload")
async def upload_card_image(
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
        db.commit()
        db.refresh(image)

        try:
            raw_text = extract_text_from_image(str(file_path))
            barcode_values = decode_barcodes(str(file_path))

            combined_text = raw_text

            if barcode_values:
                combined_text += "\n\nBARCODE_CANDIDATES:\n"
                combined_text += "\n".join(barcode_values)

            parsed = parse_card_data(
                raw_text=combined_text,
                brand=None,
            )

            candidates = build_extraction_candidates(combined_text)

            if candidates:
                combined_text += "\n\nEXTRACTION_CANDIDATES:\n"

                for candidate in candidates:
                    combined_text += (
                        f"\n[{candidate.source}] "
                        f"{candidate.candidate_type} "
                        f"{candidate.value} "
                        f"(confidence={candidate.confidence_score})"
                    )

            extraction = ExtractionAttempt(
                gift_card_id=gift_card_id,
                method="ocr_tesseract_barcode",
                extracted_card_number=parsed.card_number,
                extracted_pin=parsed.pin,
                confidence_score=parsed.confidence_score,
                raw_text=combined_text,
            )

            db.add(extraction)
            db.commit()

            db.refresh(extraction)

            for candidate in candidates:
                candidate_row = ExtractionCandidate(
                    extraction_attempt_id=extraction.id,
                    gift_card_id=gift_card_id,
                    candidate_type=candidate.candidate_type,
                    source=candidate.source,
                    value=candidate.value,
                    confidence_score=candidate.confidence_score,
                    notes=candidate.notes,
                )

                db.add(candidate_row)

            db.commit()

        except Exception as e:
            print("OCR/barcode extraction failed:", e)

        return image

    finally:
        db.close()
