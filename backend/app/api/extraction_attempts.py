from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.extraction_attempt import ExtractionAttempt


router = APIRouter(prefix="/extraction-attempts", tags=["extraction-attempts"])


class ExtractionAttemptCreate(BaseModel):
    gift_card_id: int
    method: str
    extracted_card_number: str | None = None
    extracted_pin: str | None = None
    confidence_score: float | None = None
    raw_text: str | None = None


@router.post("/")
def create_extraction_attempt(payload: ExtractionAttemptCreate):
    db: Session = SessionLocal()

    try:
        attempt = ExtractionAttempt(
            gift_card_id=payload.gift_card_id,
            method=payload.method,
            extracted_card_number=payload.extracted_card_number,
            extracted_pin=payload.extracted_pin,
            confidence_score=payload.confidence_score,
            raw_text=payload.raw_text,
        )

        db.add(attempt)
        db.commit()
        db.refresh(attempt)

        return attempt

    finally:
        db.close()


@router.get("/gift-card/{gift_card_id}")
def list_extraction_attempts(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        return (
            db.query(ExtractionAttempt)
            .filter(ExtractionAttempt.gift_card_id == gift_card_id)
            .order_by(ExtractionAttempt.created_at.desc())
            .all()
        )

    finally:
        db.close()