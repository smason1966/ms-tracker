from fastapi import APIRouter
from sqlalchemy import case
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.extraction_candidate import ExtractionCandidate
from app.models.extraction_attempt import ExtractionAttempt
from app.services.field_encryption import decrypt_field

router = APIRouter(prefix="/extraction-candidates", tags=["extraction-candidates"])


def serialize_extraction_candidate(candidate: ExtractionCandidate) -> dict:
    return {
        "id": candidate.id,
        "extraction_attempt_id": candidate.extraction_attempt_id,
        "gift_card_id": candidate.gift_card_id,
        "candidate_type": candidate.candidate_type,
        "source": candidate.source,
        "value": decrypt_field(candidate.value),
        "confidence_score": candidate.confidence_score,
        "notes": decrypt_field(candidate.notes),
        "created_at": candidate.created_at,
    }


@router.get("/gift-card/{gift_card_id}")
def list_extraction_candidates(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        candidates = (
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
        return [
            serialize_extraction_candidate(candidate)
            for candidate in candidates
        ]

    finally:
        db.close()
