"""add fuel account barcode fields

Revision ID: c5a9f2d1e4b6
Revises: b7e4d8a1c6f2
Create Date: 2026-05-19 10:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c5a9f2d1e4b6"
down_revision: Union[str, Sequence[str], None] = "b7e4d8a1c6f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "fuel_reward_accounts",
        sa.Column("barcode_image_url", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "fuel_reward_accounts",
        sa.Column("barcode_value", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("fuel_reward_accounts", "barcode_value")
    op.drop_column("fuel_reward_accounts", "barcode_image_url")
