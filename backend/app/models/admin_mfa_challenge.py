from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.time import utc_now


class AdminMfaChallenge(Base):
    __tablename__ = "admin_mfa_challenges"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    admin_user_id: Mapped[int] = mapped_column(ForeignKey("admin_users.id"), nullable=False, index=True)
    challenge_token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(100), nullable=True)
