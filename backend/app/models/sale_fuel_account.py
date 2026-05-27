from datetime import datetime

from app.utils.time import utc_now
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SaleFuelAccount(Base):
    __tablename__ = "sale_fuel_accounts"
    __table_args__ = (
        UniqueConstraint(
            "sale_id",
            "fuel_reward_account_id",
            name="uq_sale_fuel_account",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id"), nullable=False)
    fuel_reward_account_id: Mapped[int] = mapped_column(
        ForeignKey("fuel_reward_accounts.id"),
        nullable=False,
    )
    points_sold: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_value: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    is_full_account_sale: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    fuel_overage_override: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    overage_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payout_received: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    payment_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("payment_accounts.id"),
        nullable=True,
    )
    settlement_received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    adjustment_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    adjustment_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    settlement_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
