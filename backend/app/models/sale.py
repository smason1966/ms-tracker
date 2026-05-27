from datetime import datetime

from app.utils.time import utc_now
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Sale(Base):
    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("buyers.id"), nullable=False)
    sold_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    expected_payout: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    card_payout_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    fuel_rate_per_1000: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    expected_payment_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    payout_received: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    payment_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("payment_accounts.id"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(50), default="SOLD_PENDING_PAYMENT", nullable=False)
    buyer_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    internal_tags: Mapped[str | None] = mapped_column(Text, nullable=True)
    export_profile: Mapped[str | None] = mapped_column(String(100), nullable=True)
    settlement_status_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    manual_payout_override_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    linked_external_reference_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    imported_from_environment: Mapped[str | None] = mapped_column(String(100), nullable=True)
    imported_source_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    imported_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
