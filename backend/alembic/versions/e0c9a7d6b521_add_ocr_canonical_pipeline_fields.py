"""add ocr canonical pipeline fields

Revision ID: e0c9a7d6b521
Revises: c36f7d2a41b9
Create Date: 2026-05-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e0c9a7d6b521"
down_revision: Union[str, Sequence[str], None] = "c36f7d2a41b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "gift_cards",
        sa.Column(
            "ocr_status",
            sa.String(length=50),
            server_default="uploading",
            nullable=False,
        ),
    )
    op.alter_column("gift_cards", "ocr_status", server_default=None)
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
    op.drop_column("gift_cards", "ocr_status")
