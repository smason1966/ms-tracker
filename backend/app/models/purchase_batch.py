from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class PurchaseBatch(Base):
    __tablename__ = "purchase_batches"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    store_name: Mapped[str] = mapped_column(String(100), nullable=False)
    purchase_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    total_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    purchase_total_paid: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    sales_tax: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    activation_fees: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    discounts: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    fuel_point_estimated_value: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    fuel_points_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fuel_points_unit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fuel_points_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    financial_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
