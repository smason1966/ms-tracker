from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class CardImage(Base):
    __tablename__ = "card_images"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    gift_card_id: Mapped[int] = mapped_column(ForeignKey("gift_cards.id"), nullable=False)

    image_type: Mapped[str] = mapped_column(String(50), nullable=False)
    original_image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    processed_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)