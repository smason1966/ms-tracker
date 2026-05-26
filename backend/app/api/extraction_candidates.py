from fastapi import APIRouter
from sqlalchemy import case
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.extraction_candidate import ExtractionCandidate
from app.models.extraction_attempt import ExtractionAttempt

router = APIRouter(prefix="/extraction-candidates", tags=["extraction-candidates"])


@router.get("/gift-card/{gift_card_id}")
def list_extraction_candidates(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        return (
            db.query(ExtractionCandidate)
            .join(
                ExtractionAttempt,
                ExtractionAttempt.id == ExtractionCandidate.extraction_attempt_id,
            )
            .filter(ExtractionCandidate.gift_card_id == gift_card_id)
            .order_by(
                ExtractionAttempt.created_at.desc(),
                ExtractionCandidate.confidence_score.desc(),
                case(
                    (ExtractionCandidate.source == "barcode", 3),
                    (ExtractionCandidate.source == "zone_consensus", 2),
                    (ExtractionCandidate.source == "zone", 1),
                    else_=0,
                ).desc(),
                ExtractionCandidate.id.desc(),
            )
            .all()
        )

    finally:
        db.close()
