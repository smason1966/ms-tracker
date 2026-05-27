from datetime import datetime

from app.utils.time import utc_now
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Buyer(Base):
    __tablename__ = "buyers"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    buyer_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    buyer_category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    preferred_contact_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contact_handle: Mapped[str | None] = mapped_column(String(255), nullable=True)
    backup_contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    default_payout_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_payout_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    requires_card_images: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    requires_receipt_images: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    preferred_export_type: Mapped[str] = mapped_column(String(50), default="TXT", nullable=False)
    card_export_format: Mapped[str | None] = mapped_column(Text, nullable=True)
    fuel_export_format: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_payment_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("payment_accounts.id"),
        nullable=True,
    )
    expected_payment_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    settlement_behavior_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_timing_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_reference_format: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_card_exports_by_brand: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    preserve_blank_export_columns: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    zip_organization: Mapped[str] = mapped_column(String(50), default="GROUP_BY_BRAND", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)


class BuyerExternalIdentifier(Base):
    __tablename__ = "buyer_external_identifiers"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    buyer_id: Mapped[int] = mapped_column(
        ForeignKey("buyers.id"),
        index=True,
        nullable=False,
    )
    platform_source: Mapped[str] = mapped_column(String(100), nullable=False)
    identifier: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
