from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PaymentAccount(Base):
    __tablename__ = "payment_accounts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    account_type: Mapped[str] = mapped_column(String(50), nullable=False)
    institution: Mapped[str | None] = mapped_column(String(120), nullable=True)
    last_four: Mapped[str | None] = mapped_column(String(10), nullable=True)
    account_identifier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payment_identifier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_business_account: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    bank_account_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
