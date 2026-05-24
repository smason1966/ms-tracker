from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RewardProgram(Base):
    __tablename__ = "reward_programs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    short_code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    estimated_value_cents_per_point: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 4),
        nullable=True,
    )
    value_unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    eligible_for_credit_cards: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    transferable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
