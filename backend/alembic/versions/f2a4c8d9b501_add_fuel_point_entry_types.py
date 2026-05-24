"""add fuel point entry types

Revision ID: f2a4c8d9b501
Revises: edb6a1c9f304
Create Date: 2026-05-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "f2a4c8d9b501"
down_revision = "edb6a1c9f304"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fuel_point_entries",
        sa.Column("entry_type", sa.Text(), nullable=False, server_default="PURCHASE"),
    )
    op.alter_column("fuel_point_entries", "entry_type", server_default=None)
    op.alter_column("fuel_point_entries", "purchase_batch_id", nullable=True)


def downgrade() -> None:
    op.alter_column("fuel_point_entries", "purchase_batch_id", nullable=False)
    op.drop_column("fuel_point_entries", "entry_type")
