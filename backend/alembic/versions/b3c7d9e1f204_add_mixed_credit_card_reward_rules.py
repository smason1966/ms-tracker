"""add mixed credit card reward rules

Revision ID: b3c7d9e1f204
Revises: a2d5f7c9b804
Create Date: 2026-05-24
"""

from alembic import op
from datetime import datetime
import sqlalchemy as sa


revision = "b3c7d9e1f204"
down_revision = "a2d5f7c9b804"
branch_labels = None
depends_on = None


def table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if table_name in table_names() and column.name not in columns(table_name):
        op.add_column(table_name, column)


def seed_spending_category(key: str, name: str, notes: str | None = None) -> None:
    bind = op.get_bind()
    existing = bind.execute(
        sa.text("select id from spending_categories where lower(key) = lower(:key)"),
        {"key": key},
    ).first()
    if not existing:
        bind.execute(
            sa.text(
                "insert into spending_categories (key, name, notes, created_at) "
                "values (:key, :name, :notes, :created_at)"
            ),
            {
                "key": key,
                "name": name,
                "notes": notes,
                "created_at": datetime.utcnow(),
            },
        )


def upgrade() -> None:
    add_column_if_missing("stores", sa.Column("merchant_type", sa.String(length=80), nullable=True))

    add_column_if_missing("credit_card_reward_rules", sa.Column("store_id", sa.Integer(), nullable=True))
    add_column_if_missing("credit_card_reward_rules", sa.Column("reward_type", sa.String(length=50), server_default="points", nullable=False))
    add_column_if_missing("credit_card_reward_rules", sa.Column("merchant_type", sa.String(length=80), nullable=True))
    add_column_if_missing("credit_card_reward_rules", sa.Column("value", sa.Numeric(12, 4), nullable=True))
    add_column_if_missing("credit_card_reward_rules", sa.Column("priority", sa.Integer(), server_default="100", nullable=False))

    add_column_if_missing("purchase_payments", sa.Column("matched_rule_id", sa.Integer(), nullable=True))
    add_column_if_missing("purchase_payments", sa.Column("reward_type", sa.String(length=50), nullable=True))
    add_column_if_missing("purchase_payments", sa.Column("points_earned", sa.Numeric(14, 4), nullable=True))
    add_column_if_missing("purchase_payments", sa.Column("cashback_amount", sa.Numeric(12, 2), nullable=True))
    add_column_if_missing("purchase_payments", sa.Column("statement_credit_amount", sa.Numeric(12, 2), nullable=True))
    add_column_if_missing("purchase_payments", sa.Column("purchase_discount_amount", sa.Numeric(12, 2), nullable=True))
    add_column_if_missing("purchase_payments", sa.Column("effective_savings_amount", sa.Numeric(12, 2), nullable=True))
    add_column_if_missing("purchase_payments", sa.Column("priority", sa.Integer(), nullable=True))

    add_column_if_missing("credit_card_reward_transactions", sa.Column("matched_rule_id", sa.Integer(), nullable=True))
    add_column_if_missing("credit_card_reward_transactions", sa.Column("reward_type", sa.String(length=50), server_default="points", nullable=False))
    add_column_if_missing("credit_card_reward_transactions", sa.Column("points_earned", sa.Numeric(14, 4), server_default="0", nullable=False))
    add_column_if_missing("credit_card_reward_transactions", sa.Column("cashback_amount", sa.Numeric(12, 2), server_default="0", nullable=False))
    add_column_if_missing("credit_card_reward_transactions", sa.Column("statement_credit_amount", sa.Numeric(12, 2), server_default="0", nullable=False))
    add_column_if_missing("credit_card_reward_transactions", sa.Column("purchase_discount_amount", sa.Numeric(12, 2), server_default="0", nullable=False))
    add_column_if_missing("credit_card_reward_transactions", sa.Column("effective_savings_amount", sa.Numeric(12, 2), server_default="0", nullable=False))
    add_column_if_missing("credit_card_reward_transactions", sa.Column("priority", sa.Integer(), nullable=True))

    if "spending_categories" in table_names():
        seed_spending_category("fuel", "Fuel")
        seed_spending_category("retail", "Retail")
        seed_spending_category("target", "Target")
        seed_spending_category("drugstore", "Drugstore")

    op.execute(
        "update credit_card_reward_rules set reward_type = 'points' "
        "where reward_type is null or trim(reward_type) = ''"
    )
    op.execute(
        "update credit_card_reward_rules set value = multiplier "
        "where value is null and multiplier is not null"
    )
    op.execute(
        "update credit_card_reward_transactions set reward_type = 'points', "
        "points_earned = coalesce(rewards_earned, 0), "
        "cashback_amount = coalesce(cashback_amount, 0), "
        "statement_credit_amount = coalesce(statement_credit_amount, 0), "
        "purchase_discount_amount = coalesce(purchase_discount_amount, 0), "
        "effective_savings_amount = coalesce(effective_savings_amount, 0) "
        "where reward_type is null or reward_type = 'points'"
    )


def downgrade() -> None:
    pass
