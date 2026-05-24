from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExtractionProfileMetric(Base):
    __tablename__ = "extraction_profile_metrics"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    extraction_attempt_id: Mapped[int] = mapped_column(
        ForeignKey("extraction_attempts.id"),
        nullable=False,
    )
    gift_card_id: Mapped[int] = mapped_column(ForeignKey("gift_cards.id"), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    profile_key: Mapped[str] = mapped_column(String(100), nullable=False)
    detected_credential_type: Mapped[str] = mapped_column(String(100), nullable=False)
    selected_rotation_degrees: Mapped[int | None] = mapped_column(Integer, nullable=True)
    structured_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    selected_card_number: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    selected_pin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    candidate_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rejected_candidate_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
