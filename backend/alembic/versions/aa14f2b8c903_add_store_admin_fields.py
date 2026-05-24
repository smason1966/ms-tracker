"""add store admin fields

Revision ID: aa14f2b8c903
Revises: e9a1c4d7b6f2
Create Date: 2026-05-21 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "aa14f2b8c903"
down_revision: str | Sequence[str] | None = "e9a1c4d7b6f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "stores",
        sa.Column("retailer_group", sa.String(length=100), nullable=True),
    )
    op.add_column("stores", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("stores", "notes")
    op.drop_column("stores", "retailer_group")
