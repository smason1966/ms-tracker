"""add fuel account sale fields

Revision ID: d48a13f2b7c6
Revises: c36f7d2a41b9
Create Date: 2026-05-20 04:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d48a13f2b7c6"
down_revision: Union[str, Sequence[str], None] = "c36f7d2a41b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("fuel_reward_accounts", sa.Column("buyer_id", sa.Integer(), nullable=True))
    op.add_column("fuel_reward_accounts", sa.Column("sold_to", sa.String(255), nullable=True))
    op.add_column("fuel_reward_accounts", sa.Column("sold_date", sa.Date(), nullable=True))
    op.add_column("fuel_reward_accounts", sa.Column("sale_price", sa.Numeric(12, 2), nullable=True))
    op.add_column("fuel_reward_accounts", sa.Column("sale_notes", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_fuel_reward_accounts_buyer_id_buyers",
        "fuel_reward_accounts",
        "buyers",
        ["buyer_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_fuel_reward_accounts_buyer_id_buyers",
        "fuel_reward_accounts",
        type_="foreignkey",
    )
    op.drop_column("fuel_reward_accounts", "sale_notes")
    op.drop_column("fuel_reward_accounts", "sale_price")
    op.drop_column("fuel_reward_accounts", "sold_date")
    op.drop_column("fuel_reward_accounts", "sold_to")
    op.drop_column("fuel_reward_accounts", "buyer_id")
