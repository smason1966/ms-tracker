"""add liquidation fields

Revision ID: ab12c4d8e901
Revises: f8b1d4c2a709
Create Date: 2026-05-19 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ab12c4d8e901"
down_revision: Union[str, Sequence[str], None] = "f8b1d4c2a709"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("gift_cards", sa.Column("asking_price", sa.Numeric(12, 2), nullable=True))
    op.add_column("gift_cards", sa.Column("expected_payout", sa.Numeric(12, 2), nullable=True))
    op.add_column("gift_cards", sa.Column("liquidation_rate", sa.Numeric(8, 4), nullable=True))
    op.add_column("gift_cards", sa.Column("buyer_id", sa.Integer(), nullable=True))
    op.add_column("gift_cards", sa.Column("reserved_at", sa.DateTime(), nullable=True))
    op.add_column("gift_cards", sa.Column("sold_at", sa.DateTime(), nullable=True))
    op.add_column("gift_cards", sa.Column("settlement_received_at", sa.DateTime(), nullable=True))
    op.add_column("gift_cards", sa.Column("payout_received", sa.Numeric(12, 2), nullable=True))
    op.add_column("gift_cards", sa.Column("internal_notes", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_gift_cards_buyer_id_buyers",
        "gift_cards",
        "buyers",
        ["buyer_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_gift_cards_buyer_id_buyers", "gift_cards", type_="foreignkey")
    op.drop_column("gift_cards", "internal_notes")
    op.drop_column("gift_cards", "payout_received")
    op.drop_column("gift_cards", "settlement_received_at")
    op.drop_column("gift_cards", "sold_at")
    op.drop_column("gift_cards", "reserved_at")
    op.drop_column("gift_cards", "buyer_id")
    op.drop_column("gift_cards", "liquidation_rate")
    op.drop_column("gift_cards", "expected_payout")
    op.drop_column("gift_cards", "asking_price")
