"""add credit card payment ops fields

Revision ID: d7c4a1b8e2f3
Revises: ab9d2e7c5f41
Create Date: 2026-05-21 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "d7c4a1b8e2f3"
down_revision: str | Sequence[str] | None = "ab9d2e7c5f41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "credit_cards",
        sa.Column("statement_paid_amount", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "credit_cards",
        sa.Column(
            "minimum_payment_paid",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        "credit_cards",
        sa.Column(
            "autopay_enabled",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.alter_column("credit_cards", "minimum_payment_paid", server_default=None)
    op.alter_column("credit_cards", "autopay_enabled", server_default=None)


def downgrade() -> None:
    op.drop_column("credit_cards", "autopay_enabled")
    op.drop_column("credit_cards", "minimum_payment_paid")
    op.drop_column("credit_cards", "statement_paid_amount")
