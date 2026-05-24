"""add gift card void reason

Revision ID: bfd2a7e91c44
Revises: aa14f2b8c903
Create Date: 2026-05-21 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "bfd2a7e91c44"
down_revision: Union[str, Sequence[str], None] = "aa14f2b8c903"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "gift_cards",
        sa.Column("void_reason", sa.String(length=100), nullable=True),
    )
    op.execute("UPDATE gift_cards SET status = 'VOIDED' WHERE status = 'VOID'")


def downgrade() -> None:
    op.execute("UPDATE gift_cards SET status = 'VOID' WHERE status = 'VOIDED'")
    op.drop_column("gift_cards", "void_reason")
