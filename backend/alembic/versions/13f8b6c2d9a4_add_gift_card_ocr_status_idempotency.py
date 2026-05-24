"""add gift card ocr status and intake idempotency

Revision ID: 13f8b6c2d9a4
Revises: 9d1a7c4e2f56, c8f1a4d2b6e9
Create Date: 2026-05-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "13f8b6c2d9a4"
down_revision: Union[str, Sequence[str], None] = (
    "9d1a7c4e2f56",
    "c8f1a4d2b6e9",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "gift_cards",
        sa.Column(
            "ocr_status",
            sa.String(length=50),
            server_default="pending",
            nullable=False,
        ),
    )
    op.add_column(
        "gift_cards",
        sa.Column("intake_idempotency_key", sa.String(length=100), nullable=True),
    )
    op.create_unique_constraint(
        "uq_gift_cards_intake_idempotency_key",
        "gift_cards",
        ["intake_idempotency_key"],
    )
    op.alter_column("gift_cards", "ocr_status", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        "uq_gift_cards_intake_idempotency_key",
        "gift_cards",
        type_="unique",
    )
    op.drop_column("gift_cards", "intake_idempotency_key")
    op.drop_column("gift_cards", "ocr_status")
