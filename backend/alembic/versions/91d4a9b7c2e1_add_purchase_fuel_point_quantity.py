"""add purchase fuel point quantity

Revision ID: 91d4a9b7c2e1
Revises: 7c4a2e0f1d93
Create Date: 2026-05-18 19:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "91d4a9b7c2e1"
down_revision: Union[str, Sequence[str], None] = "7c4a2e0f1d93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "purchase_batches",
        sa.Column("fuel_points_quantity", sa.Integer(), nullable=True),
    )
    op.add_column(
        "purchase_batches",
        sa.Column("fuel_points_unit", sa.Integer(), nullable=True),
    )
    op.add_column(
        "purchase_batches",
        sa.Column("fuel_points_notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("purchase_batches", "fuel_points_notes")
    op.drop_column("purchase_batches", "fuel_points_unit")
    op.drop_column("purchase_batches", "fuel_points_quantity")
