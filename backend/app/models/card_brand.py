from datetime import datetime

from app.utils.time import utc_now

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CardBrand(Base):
    __tablename__ = "card_brands"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_barcode: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_magstripe: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_ocr_template: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    parser_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    parsing_profile: Mapped[str | None] = mapped_column(String(80), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    magstripe_parser_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    magstripe_parser_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sample_magstripe_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    card_number_regex: Mapped[str | None] = mapped_column(Text, nullable=True)
    pin_regex: Mapped[str | None] = mapped_column(Text, nullable=True)
    pin_label_keywords: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_pin_length: Mapped[int | None] = mapped_column(nullable=True)
    card_number_source_priority: Mapped[str | None] = mapped_column(String(120), nullable=True)
    pin_spatial_rule: Mapped[str | None] = mapped_column(String(120), nullable=True)
    gift_code_regex: Mapped[str | None] = mapped_column(Text, nullable=True)
    gift_code_prefixes: Mapped[str | None] = mapped_column(Text, nullable=True)
    gift_code_expected_length: Mapped[int | None] = mapped_column(nullable=True)
    gift_code_normalization: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ocr_confusion_map: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_orientation_preference: Mapped[str | None] = mapped_column(String(30), nullable=True)
    credential_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    ocr_zones: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
