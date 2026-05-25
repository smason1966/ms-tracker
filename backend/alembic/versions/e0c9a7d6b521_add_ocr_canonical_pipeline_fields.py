"""add ocr canonical pipeline fields

Revision ID: e0c9a7d6b521
Revises: c36f7d2a41b9
Create Date: 2026-05-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "e0c9a7d6b521"
down_revision: Union[str, Sequence[str], None] = "c36f7d2a41b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE gift_cards "
        "ADD COLUMN IF NOT EXISTS ocr_status VARCHAR(50) DEFAULT 'uploading' NOT NULL"
    )
    op.alter_column("gift_cards", "ocr_status", server_default=None)
    op.execute(
        "ALTER TABLE card_brands "
        "ADD COLUMN IF NOT EXISTS ocr_orientation_preference VARCHAR(30)"
    )
    op.execute(
        "ALTER TABLE card_brands "
        "ADD COLUMN IF NOT EXISTS credential_type VARCHAR(80)"
    )
    op.execute("ALTER TABLE card_brands ADD COLUMN IF NOT EXISTS ocr_zones TEXT")


def downgrade() -> None:
    op.drop_column("card_brands", "ocr_zones")
    op.drop_column("card_brands", "credential_type")
    op.drop_column("card_brands", "ocr_orientation_preference")
    op.drop_column("gift_cards", "ocr_status")
