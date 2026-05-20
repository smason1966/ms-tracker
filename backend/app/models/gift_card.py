from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class GiftCard(Base):
    __tablename__ = "gift_cards"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    purchase_batch_id: Mapped[int] = mapped_column(ForeignKey("purchase_batches.id"), nullable=False)

    brand: Mapped[str] = mapped_column(String(100), nullable=False)
    face_value: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    acquisition_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="NEEDS_VERIFICATION", nullable=False)

    card_number_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    pin_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    verified_balance: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verification_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification_source: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )
    verification_status: Mapped[str] = mapped_column(
        String(50),
        default="PENDING",
        nullable=False,
    )

    detected_card_number: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detected_pin: Mapped[str | None] = mapped_column(String(255), nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    sold_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sold_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sale_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    sale_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    asking_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    expected_payout: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    liquidation_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    buyer_id: Mapped[int | None] = mapped_column(ForeignKey("buyers.id"), nullable=True)
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sold_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expected_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    settlement_received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    payout_received: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
