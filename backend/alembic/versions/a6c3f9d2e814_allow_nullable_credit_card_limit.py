"""allow nullable credit card limit

Revision ID: a6c3f9d2e814
Revises: 9d4e7b2c1a63
Create Date: 2026-05-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a6c3f9d2e814"
down_revision: str | Sequence[str] | None = "9d4e7b2c1a63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "credit_cards",
        "credit_limit",
        existing_type=sa.Numeric(precision=12, scale=2),
        nullable=True,
    )


def downgrade() -> None:
    op.execute("UPDATE credit_cards SET credit_limit = 0 WHERE credit_limit IS NULL")
    op.alter_column(
        "credit_cards",
        "credit_limit",
        existing_type=sa.Numeric(precision=12, scale=2),
        nullable=False,
    )
