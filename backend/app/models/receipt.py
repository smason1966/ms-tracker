from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    purchase_batch_id: Mapped[int] = mapped_column(ForeignKey("purchase_batches.id"), nullable=False)

    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_type: Mapped[str] = mapped_column(String(50), default="receipt_image", nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retention_status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)
    retain_attachment: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    purge_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
