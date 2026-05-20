"""add purchase payments

Revision ID: f8b1d4c2a709
Revises: e4f7a2c9d105
Create Date: 2026-05-19 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f8b1d4c2a709"
down_revision: Union[str, Sequence[str], None] = "e4f7a2c9d105"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "purchase_payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("purchase_batch_id", sa.Integer(), nullable=False),
        sa.Column("payment_type", sa.String(length=50), nullable=False),
        sa.Column("credit_card_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["credit_card_id"], ["credit_cards.id"]),
        sa.ForeignKeyConstraint(["purchase_batch_id"], ["purchase_batches.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_purchase_payments_id"),
        "purchase_payments",
        ["id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_purchase_payments_id"), table_name="purchase_payments")
    op.drop_table("purchase_payments")
