from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.extraction_candidate import ExtractionCandidate

router = APIRouter(prefix="/extraction-candidates", tags=["extraction-candidates"])


@router.get("/gift-card/{gift_card_id}")
def list_extraction_candidates(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        return (
            db.query(ExtractionCandidate)
            .filter(ExtractionCandidate.gift_card_id == gift_card_id)
            .order_by(ExtractionCandidate.confidence_score.desc())
            .all()
        )

    finally:
        db.close()
