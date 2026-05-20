from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CreditCard(Base):
    __tablename__ = "credit_cards"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nickname: Mapped[str] = mapped_column(String(120), nullable=False)
    issuer: Mapped[str] = mapped_column(String(120), nullable=False)
    network: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_four: Mapped[str | None] = mapped_column(String(4), nullable=True)
    credit_limit: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    current_balance: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    statement_close_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payment_due_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opened_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    annual_fee: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    signup_bonus_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    signup_bonus_spend: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    signup_bonus_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    current_spend_progress: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        default=0,
        nullable=False,
    )
    rewards_type: Mapped[str] = mapped_column(String(50), default="OTHER", nullable=False)
    rewards_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
