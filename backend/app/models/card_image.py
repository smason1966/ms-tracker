from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class CardImage(Base):
    __tablename__ = "card_images"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    gift_card_id: Mapped[int] = mapped_column(ForeignKey("gift_cards.id"), nullable=False)

    image_type: Mapped[str] = mapped_column(String(50), nullable=False)
    original_image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    processed_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    canonical_rotation_degrees: Mapped[int | None] = mapped_column(Integer, nullable=True)
    orientation_source: Mapped[str | None] = mapped_column(String(50), nullable=True)
    canonical_transform_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_type: Mapped[str] = mapped_column(String(50), default="card_image", nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retention_status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)
    retain_attachment: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    purge_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
