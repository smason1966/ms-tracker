from datetime import datetime

from app.utils.time import utc_now

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    store_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    retailer_group: Mapped[str | None] = mapped_column(String(100), nullable=True)
    merchant_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    merchant_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    spending_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("spending_categories.id"),
        nullable=True,
    )
    reward_program_id: Mapped[int | None] = mapped_column(
        ForeignKey("reward_programs.id"),
        nullable=True,
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    earns_fuel_points: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    default_fuel_multiplier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
