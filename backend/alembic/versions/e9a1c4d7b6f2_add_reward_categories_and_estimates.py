"""add reward categories and estimates

Revision ID: e9a1c4d7b6f2
Revises: d7c4a1b8e2f3
Create Date: 2026-05-21 00:00:00.000000
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op


revision: str = "e9a1c4d7b6f2"
down_revision: str | Sequence[str] | None = "d7c4a1b8e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "spending_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index(
        op.f("ix_spending_categories_id"),
        "spending_categories",
        ["id"],
        unique=False,
    )
    op.create_table(
        "credit_card_reward_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("credit_card_id", sa.Integer(), nullable=False),
        sa.Column("spending_category_id", sa.Integer(), nullable=False),
        sa.Column("multiplier", sa.Numeric(8, 4), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["credit_card_id"], ["credit_cards.id"]),
        sa.ForeignKeyConstraint(["spending_category_id"], ["spending_categories.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "credit_card_id",
            "spending_category_id",
            name="uq_credit_card_reward_rule_category",
        ),
    )
    op.create_index(
        op.f("ix_credit_card_reward_rules_id"),
        "credit_card_reward_rules",
        ["id"],
        unique=False,
    )
    op.add_column(
        "stores",
        sa.Column("spending_category_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_stores_spending_category_id_spending_categories",
        "stores",
        "spending_categories",
        ["spending_category_id"],
        ["id"],
    )
    op.add_column(
        "purchase_payments",
        sa.Column("spending_category_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "purchase_payments",
        sa.Column("reward_multiplier", sa.Numeric(8, 4), nullable=True),
    )
    op.add_column(
        "purchase_payments",
        sa.Column("estimated_rewards_earned", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "purchase_payments",
        sa.Column("rewards_type", sa.String(length=50), nullable=True),
    )
    op.create_foreign_key(
        "fk_purchase_payments_spending_category_id_spending_categories",
        "purchase_payments",
        "spending_categories",
        ["spending_category_id"],
        ["id"],
    )

    categories = [
        {"key": "grocery", "name": "Grocery"},
        {"key": "wholesale", "name": "Wholesale"},
        {"key": "office_supply", "name": "Office Supply"},
        {"key": "gas", "name": "Gas"},
        {"key": "dining", "name": "Dining"},
        {"key": "travel", "name": "Travel"},
        {"key": "general", "name": "General"},
    ]
    category_table = sa.table(
        "spending_categories",
        sa.column("key", sa.String),
        sa.column("name", sa.String),
        sa.column("notes", sa.Text),
        sa.column("created_at", sa.DateTime),
    )
    op.bulk_insert(
        category_table,
        [
            {
                **category,
                "notes": None,
                "created_at": datetime.now(UTC).replace(tzinfo=None),
            }
            for category in categories
        ],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_purchase_payments_spending_category_id_spending_categories",
        "purchase_payments",
        type_="foreignkey",
    )
    op.drop_column("purchase_payments", "rewards_type")
    op.drop_column("purchase_payments", "estimated_rewards_earned")
    op.drop_column("purchase_payments", "reward_multiplier")
    op.drop_column("purchase_payments", "spending_category_id")
    op.drop_constraint(
        "fk_stores_spending_category_id_spending_categories",
        "stores",
        type_="foreignkey",
    )
    op.drop_column("stores", "spending_category_id")
    op.drop_index(
        op.f("ix_credit_card_reward_rules_id"),
        table_name="credit_card_reward_rules",
    )
    op.drop_table("credit_card_reward_rules")
    op.drop_index(op.f("ix_spending_categories_id"), table_name="spending_categories")
    op.drop_table("spending_categories")
