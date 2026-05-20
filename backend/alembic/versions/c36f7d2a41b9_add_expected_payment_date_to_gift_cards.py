"""add expected payment date to gift cards

Revision ID: c36f7d2a41b9
Revises: b21d5f4a8c33
Create Date: 2026-05-19 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c36f7d2a41b9"
down_revision: Union[str, Sequence[str], None] = "b21d5f4a8c33"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "gift_cards",
        sa.Column("expected_payment_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("gift_cards", "expected_payment_date")
