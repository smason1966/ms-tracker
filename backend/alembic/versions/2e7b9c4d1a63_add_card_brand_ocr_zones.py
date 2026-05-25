"""add card brand ocr zones

Revision ID: 2e7b9c4d1a63
Revises: 13f8b6c2d9a4
Create Date: 2026-05-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "2e7b9c4d1a63"
down_revision: Union[str, Sequence[str], None] = "13f8b6c2d9a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
