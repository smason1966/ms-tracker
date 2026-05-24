"""add credit card product changes

Revision ID: 8c4f1a2d6b90
Revises: 7b2e1c4d9f03
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8c4f1a2d6b90"
down_revision: Union[str, None] = "7b2e1c4d9f03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if not has_table("credit_card_product_changes"):
        op.create_table(
            "credit_card_product_changes",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("credit_card_id", sa.Integer(), nullable=False),
            sa.Column("previous_product_name", sa.String(length=160), nullable=False),
            sa.Column("new_product_name", sa.String(length=160), nullable=False),
            sa.Column("effective_date", sa.Date(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["credit_card_id"], ["credit_cards.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_credit_card_product_changes_id"),
            "credit_card_product_changes",
            ["id"],
            unique=False,
        )

    for column in [
        sa.Column("effective_start_date", sa.Date(), nullable=True),
        sa.Column("effective_end_date", sa.Date(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=True),
    ]:
        if not has_column("credit_card_reward_rules", column.name):
            op.add_column("credit_card_reward_rules", column)

    op.execute(
        "UPDATE credit_card_reward_rules "
        "SET effective_start_date = COALESCE(effective_start_date, created_at::date, CURRENT_DATE), "
        "active = COALESCE(active, true)"
    )
    op.alter_column("credit_card_reward_rules", "effective_start_date", nullable=False)
    op.alter_column("credit_card_reward_rules", "active", nullable=False)

    for column in [
        sa.Column("applied_multiplier", sa.Numeric(8, 4), nullable=True),
        sa.Column("calculated_rewards", sa.Numeric(12, 2), nullable=True),
        sa.Column("calculation_source", sa.String(length=80), nullable=True),
        sa.Column("credit_card_product_snapshot", sa.String(length=160), nullable=True),
    ]:
        if not has_column("purchase_payments", column.name):
            op.add_column("purchase_payments", column)

    op.execute(
        "UPDATE purchase_payments "
        "SET applied_multiplier = COALESCE(applied_multiplier, reward_multiplier), "
        "calculated_rewards = COALESCE(calculated_rewards, estimated_rewards_earned), "
        "calculation_source = COALESCE(calculation_source, 'legacy_snapshot') "
        "WHERE estimated_rewards_earned IS NOT NULL"
    )


def downgrade() -> None:
    for column_name in [
        "credit_card_product_snapshot",
        "calculation_source",
        "calculated_rewards",
        "applied_multiplier",
    ]:
        if has_column("purchase_payments", column_name):
            op.drop_column("purchase_payments", column_name)

    for column_name in ["active", "effective_end_date", "effective_start_date"]:
        if has_column("credit_card_reward_rules", column_name):
            op.drop_column("credit_card_reward_rules", column_name)

    if has_table("credit_card_product_changes"):
        op.drop_index(op.f("ix_credit_card_product_changes_id"), table_name="credit_card_product_changes")
        op.drop_table("credit_card_product_changes")
