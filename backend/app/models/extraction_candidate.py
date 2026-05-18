from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExtractionCandidate(Base):
    __tablename__ = "extraction_candidates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    extraction_attempt_id: Mapped[int] = mapped_column(
        ForeignKey("extraction_attempts.id"),
        nullable=False,
    )
    gift_card_id: Mapped[int] = mapped_column(
        ForeignKey("gift_cards.id"),
        nullable=False,
    )

    candidate_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
