from datetime import datetime
from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class ExtractionAttempt(Base):
    __tablename__ = "extraction_attempts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    gift_card_id: Mapped[int] = mapped_column(ForeignKey("gift_cards.id"), nullable=False)

    method: Mapped[str] = mapped_column(String(50), nullable=False)
    extracted_card_number: Mapped[str | None] = mapped_column(String(255), nullable=True)
    extracted_pin: Mapped[str | None] = mapped_column(String(255), nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)