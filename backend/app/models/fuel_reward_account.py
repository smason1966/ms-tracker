from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FuelRewardAccount(Base):
    __tablename__ = "fuel_reward_accounts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    retailer: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    alt_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="ACTIVE", nullable=False)
    target_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    barcode_image_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    barcode_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    login_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    buyer_id: Mapped[int | None] = mapped_column(ForeignKey("buyers.id"), nullable=True)
    sold_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sold_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expected_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sale_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    sale_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
