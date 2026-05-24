"""add sale asset settlement fields

Revision ID: edb6a1c9f304
Revises: c9e4d7f1a203
Create Date: 2026-05-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "edb6a1c9f304"
down_revision = "c9e4d7f1a203"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table_name in ("sale_gift_cards", "sale_fuel_accounts"):
        op.add_column(table_name, sa.Column("payout_received", sa.Numeric(12, 2), nullable=True))
        op.add_column(table_name, sa.Column("settlement_received_at", sa.DateTime(), nullable=True))
        op.add_column(table_name, sa.Column("adjustment_amount", sa.Numeric(12, 2), nullable=True))
        op.add_column(table_name, sa.Column("adjustment_reason", sa.Text(), nullable=True))
        op.add_column(table_name, sa.Column("settlement_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    for table_name in ("sale_fuel_accounts", "sale_gift_cards"):
        op.drop_column(table_name, "settlement_notes")
        op.drop_column(table_name, "adjustment_reason")
        op.drop_column(table_name, "adjustment_amount")
        op.drop_column(table_name, "settlement_received_at")
        op.drop_column(table_name, "payout_received")
