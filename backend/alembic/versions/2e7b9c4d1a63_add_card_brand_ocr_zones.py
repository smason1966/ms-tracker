"""add card brand ocr zones

Revision ID: 2e7b9c4d1a63
Revises: 13f8b6c2d9a4
Create Date: 2026-05-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "2e7b9c4d1a63"
down_revision: Union[str, Sequence[str], None] = "13f8b6c2d9a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "card_brands",
        sa.Column("ocr_orientation_preference", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "card_brands",
        sa.Column("credential_type", sa.String(length=80), nullable=True),
    )
    op.add_column("card_brands", sa.Column("ocr_zones", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("card_brands", "ocr_zones")
    op.drop_column("card_brands", "credential_type")
    op.drop_column("card_brands", "ocr_orientation_preference")
