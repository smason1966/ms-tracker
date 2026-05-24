"""add bundled sales

Revision ID: b4c7e2f9a901
Revises: a8b3c6d9e102
Create Date: 2026-05-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "b4c7e2f9a901"
down_revision = "a8b3c6d9e102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("buyer_id", sa.Integer(), nullable=False),
        sa.Column("sold_at", sa.DateTime(), nullable=False),
        sa.Column("expected_payout", sa.Numeric(12, 2), nullable=False),
        sa.Column("payout_received", sa.Numeric(12, 2), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["buyer_id"], ["buyers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sales_id"), "sales", ["id"], unique=False)

    op.create_table(
        "sale_gift_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sale_id", sa.Integer(), nullable=False),
        sa.Column("gift_card_id", sa.Integer(), nullable=False),
        sa.Column("expected_payout", sa.Numeric(12, 2), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["gift_card_id"], ["gift_cards.id"]),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sale_id", "gift_card_id", name="uq_sale_gift_card"),
    )
    op.create_index(op.f("ix_sale_gift_cards_id"), "sale_gift_cards", ["id"], unique=False)

    op.create_table(
        "sale_fuel_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sale_id", sa.Integer(), nullable=False),
        sa.Column("fuel_reward_account_id", sa.Integer(), nullable=False),
        sa.Column("points_sold", sa.Integer(), nullable=False),
        sa.Column("expected_value", sa.Numeric(12, 2), nullable=True),
        sa.Column("is_full_account_sale", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["fuel_reward_account_id"], ["fuel_reward_accounts.id"]),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "sale_id",
            "fuel_reward_account_id",
            name="uq_sale_fuel_account",
        ),
    )
    op.create_index(op.f("ix_sale_fuel_accounts_id"), "sale_fuel_accounts", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_sale_fuel_accounts_id"), table_name="sale_fuel_accounts")
    op.drop_table("sale_fuel_accounts")
    op.drop_index(op.f("ix_sale_gift_cards_id"), table_name="sale_gift_cards")
    op.drop_table("sale_gift_cards")
    op.drop_index(op.f("ix_sales_id"), table_name="sales")
    op.drop_table("sales")
