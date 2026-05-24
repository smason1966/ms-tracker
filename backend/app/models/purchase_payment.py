from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PurchasePayment(Base):
    __tablename__ = "purchase_payments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    purchase_batch_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_batches.id"),
        nullable=False,
    )
    payment_type: Mapped[str] = mapped_column(String(50), nullable=False)
    credit_card_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_cards.id"),
        nullable=True,
    )
    reward_program_id: Mapped[int | None] = mapped_column(
        ForeignKey("reward_programs.id"),
        nullable=True,
    )
    spending_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("spending_categories.id"),
        nullable=True,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reward_multiplier: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    estimated_rewards_earned: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    applied_multiplier: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    calculated_rewards: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    calculation_source: Mapped[str | None] = mapped_column(String(80), nullable=True)
    credit_card_product_snapshot: Mapped[str | None] = mapped_column(String(160), nullable=True)
    rewards_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
