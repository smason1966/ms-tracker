from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FuelPointEntry(Base):
    __tablename__ = "fuel_point_entries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    fuel_reward_account_id: Mapped[int] = mapped_column(
        ForeignKey("fuel_reward_accounts.id"),
        nullable=False,
    )
    purchase_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("purchase_batches.id"),
        nullable=True,
    )
    earned_date: Mapped[date] = mapped_column(Date, nullable=False)
    expires_on: Mapped[date] = mapped_column(Date, nullable=False)
    multiplier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qualifying_spend: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    points_earned: Mapped[int] = mapped_column(Integer, nullable=False)
    entry_type: Mapped[str] = mapped_column(Text, default="PURCHASE", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
