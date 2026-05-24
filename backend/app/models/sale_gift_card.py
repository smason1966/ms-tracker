from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SaleGiftCard(Base):
    __tablename__ = "sale_gift_cards"
    __table_args__ = (
        UniqueConstraint("sale_id", "gift_card_id", name="uq_sale_gift_card"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id"), nullable=False)
    gift_card_id: Mapped[int] = mapped_column(ForeignKey("gift_cards.id"), nullable=False)
    expected_payout: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    payout_received: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    payment_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("payment_accounts.id"),
        nullable=True,
    )
    settlement_received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    adjustment_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    adjustment_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    settlement_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
