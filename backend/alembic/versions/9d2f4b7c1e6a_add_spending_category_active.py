"""add spending category active flag

Revision ID: 9d2f4b7c1e6a
Revises: b3c7d9e1f204
Create Date: 2026-05-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "9d2f4b7c1e6a"
down_revision: Union[str, Sequence[str], None] = "b3c7d9e1f204"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE spending_categories "
        "ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE"
    )


def downgrade() -> None:
    op.drop_column("spending_categories", "active")
