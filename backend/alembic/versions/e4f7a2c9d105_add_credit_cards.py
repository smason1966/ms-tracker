"""add credit cards

Revision ID: e4f7a2c9d105
Revises: d2b8f6c4a901
Create Date: 2026-05-19 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4f7a2c9d105"
down_revision: Union[str, Sequence[str], None] = "d2b8f6c4a901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "credit_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nickname", sa.String(length=120), nullable=False),
        sa.Column("issuer", sa.String(length=120), nullable=False),
        sa.Column("network", sa.String(length=50), nullable=True),
        sa.Column("last_four", sa.String(length=4), nullable=True),
        sa.Column("credit_limit", sa.Numeric(12, 2), nullable=False),
        sa.Column("current_balance", sa.Numeric(12, 2), nullable=True),
        sa.Column("statement_close_day", sa.Integer(), nullable=True),
        sa.Column("payment_due_day", sa.Integer(), nullable=True),
        sa.Column("opened_date", sa.Date(), nullable=True),
        sa.Column("annual_fee", sa.Numeric(12, 2), nullable=True),
        sa.Column("signup_bonus_points", sa.Integer(), nullable=True),
        sa.Column("signup_bonus_spend", sa.Numeric(12, 2), nullable=True),
        sa.Column("signup_bonus_deadline", sa.Date(), nullable=True),
        sa.Column(
            "current_spend_progress",
            sa.Numeric(12, 2),
            server_default="0",
            nullable=False,
        ),
        sa.Column("rewards_type", sa.String(length=50), server_default="OTHER", nullable=False),
        sa.Column("rewards_rate", sa.Numeric(8, 4), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_credit_cards_id"), "credit_cards", ["id"], unique=False)
    op.add_column("purchase_batches", sa.Column("credit_card_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_purchase_batches_credit_card_id_credit_cards",
        "purchase_batches",
        "credit_cards",
        ["credit_card_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_purchase_batches_credit_card_id_credit_cards",
        "purchase_batches",
        type_="foreignkey",
    )
    op.drop_column("purchase_batches", "credit_card_id")
    op.drop_index(op.f("ix_credit_cards_id"), table_name="credit_cards")
    op.drop_table("credit_cards")
