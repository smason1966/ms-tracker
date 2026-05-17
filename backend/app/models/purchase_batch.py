from datetime import datetime
from sqlalchemy import DateTime, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class PurchaseBatch(Base):
    __tablename__ = "purchase_batches"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    store_name: Mapped[str] = mapped_column(String(100), nullable=False)
    purchase_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    total_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)