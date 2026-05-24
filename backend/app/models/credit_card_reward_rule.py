from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CreditCardRewardRule(Base):
    __tablename__ = "credit_card_reward_rules"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    credit_card_id: Mapped[int] = mapped_column(
        ForeignKey("credit_cards.id"),
        nullable=False,
    )
    spending_category_id: Mapped[int] = mapped_column(
        ForeignKey("spending_categories.id"),
        nullable=False,
    )
    reward_program_id: Mapped[int | None] = mapped_column(
        ForeignKey("reward_programs.id"),
        nullable=True,
    )
    multiplier: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    effective_start_date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    effective_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
