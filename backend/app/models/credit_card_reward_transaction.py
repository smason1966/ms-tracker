from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CreditCardRewardTransaction(Base):
    __tablename__ = "credit_card_reward_transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    purchase_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_batches.id"),
        index=True,
        nullable=False,
    )
    credit_card_id: Mapped[int] = mapped_column(
        ForeignKey("credit_cards.id"),
        index=True,
        nullable=False,
    )
    player_id: Mapped[int | None] = mapped_column(
        ForeignKey("players.id"),
        index=True,
        nullable=True,
    )
    reward_program_id: Mapped[int | None] = mapped_column(
        ForeignKey("reward_programs.id"),
        index=True,
        nullable=True,
    )
    spending_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("spending_categories.id"),
        index=True,
        nullable=True,
    )
    purchase_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    qualifying_spend: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    multiplier: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    rewards_earned: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    calculation_source: Mapped[str] = mapped_column(String(80), nullable=False)
    credit_card_product_snapshot: Mapped[str | None] = mapped_column(String(160), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
