from datetime import date, datetime
from decimal import Decimal

from app.utils.time import utc_now
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CreditCard(Base):
    __tablename__ = "credit_cards"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    player_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"), nullable=True)
    issuer_id: Mapped[int | None] = mapped_column(ForeignKey("card_issuers.id"), nullable=True)
    network_id: Mapped[int | None] = mapped_column(ForeignKey("card_networks.id"), nullable=True)
    reward_program_id: Mapped[int | None] = mapped_column(
        ForeignKey("reward_programs.id"),
        nullable=True,
    )
    nickname: Mapped[str] = mapped_column(String(120), nullable=False)
    issuer: Mapped[str] = mapped_column(String(120), nullable=False)
    network: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_four: Mapped[str | None] = mapped_column(String(4), nullable=True)
    credit_limit: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    current_balance: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    statement_balance: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    statement_paid_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    available_credit: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    reported_utilization: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    minimum_payment_due: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    minimum_payment_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    autopay_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    payment_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_statement_close_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    preferred_utilization: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    apr: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    payment_options: Mapped[str | None] = mapped_column(Text, nullable=True)
    statement_close_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payment_due_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opened_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_last_used: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_last_product_change: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_closed: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_last_cli: Mapped[date | None] = mapped_column(Date, nullable=True)
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
    category_tags: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    reports_to_ex: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reports_to_tu: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reports_to_eq: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
