from datetime import date, datetime

from app.utils.time import utc_now
from sqlalchemy import Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CreditCardProductChange(Base):
    __tablename__ = "credit_card_product_changes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    credit_card_id: Mapped[int] = mapped_column(
        ForeignKey("credit_cards.id"),
        nullable=False,
    )
    previous_product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    new_product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
