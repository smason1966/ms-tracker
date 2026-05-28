from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.extraction_attempt import ExtractionAttempt
from app.services.field_encryption import encrypt_field, try_decrypt_field


router = APIRouter(prefix="/extraction-attempts", tags=["extraction-attempts"])


class ExtractionAttemptCreate(BaseModel):
    gift_card_id: int
    method: str
    extracted_card_number: str | None = None
    extracted_pin: str | None = None
    confidence_score: float | None = None
    raw_text: str | None = None


def serialize_extraction_attempt(attempt: ExtractionAttempt) -> dict:
    extracted_card_number, card_unavailable = try_decrypt_field(
        attempt.extracted_card_number
    )
    extracted_pin, pin_unavailable = try_decrypt_field(attempt.extracted_pin)
    raw_text, raw_text_unavailable = try_decrypt_field(attempt.raw_text)
    return {
        "id": attempt.id,
        "gift_card_id": attempt.gift_card_id,
        "method": attempt.method,
        "extracted_card_number": extracted_card_number,
        "extracted_pin": extracted_pin,
        "confidence_score": attempt.confidence_score,
        "raw_text": raw_text,
        "credential_unavailable": (
            card_unavailable or pin_unavailable or raw_text_unavailable
        ),
        "created_at": attempt.created_at,
    }


@router.post("/")
def create_extraction_attempt(payload: ExtractionAttemptCreate):
    db: Session = SessionLocal()

    try:
        attempt = ExtractionAttempt(
            gift_card_id=payload.gift_card_id,
            method=payload.method,
            extracted_card_number=encrypt_field(payload.extracted_card_number),
            extracted_pin=encrypt_field(payload.extracted_pin),
            confidence_score=payload.confidence_score,
            raw_text=encrypt_field(payload.raw_text),
        )

        db.add(attempt)
        db.commit()
        db.refresh(attempt)

        return serialize_extraction_attempt(attempt)

    finally:
        db.close()


@router.get("/gift-card/{gift_card_id}")
def list_extraction_attempts(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        attempts = (
            db.query(ExtractionAttempt)
            .filter(ExtractionAttempt.gift_card_id == gift_card_id)
            .order_by(ExtractionAttempt.created_at.desc())
            .all()
        )
        return [serialize_extraction_attempt(attempt) for attempt in attempts]

    finally:
        db.close()
