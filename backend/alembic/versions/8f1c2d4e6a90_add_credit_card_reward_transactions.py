"""add credit card reward transactions

Revision ID: 8f1c2d4e6a90
Revises: 7a1d9c4b8e06
Create Date: 2026-05-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "8f1c2d4e6a90"
down_revision = "7a1d9c4b8e06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "credit_card_reward_transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("purchase_id", sa.Integer(), nullable=False),
        sa.Column("credit_card_id", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Integer(), nullable=True),
        sa.Column("reward_program_id", sa.Integer(), nullable=True),
        sa.Column("spending_category_id", sa.Integer(), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=False),
        sa.Column("qualifying_spend", sa.Numeric(12, 2), nullable=False),
        sa.Column("multiplier", sa.Numeric(8, 4), nullable=False),
        sa.Column("rewards_earned", sa.Numeric(14, 4), nullable=False),
        sa.Column("calculation_source", sa.String(length=80), nullable=False),
        sa.Column("credit_card_product_snapshot", sa.String(length=160), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["credit_card_id"], ["credit_cards.id"]),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
        sa.ForeignKeyConstraint(["purchase_id"], ["purchase_batches.id"]),
        sa.ForeignKeyConstraint(["reward_program_id"], ["reward_programs.id"]),
        sa.ForeignKeyConstraint(["spending_category_id"], ["spending_categories.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_credit_card_reward_transactions_credit_card_id"),
        "credit_card_reward_transactions",
        ["credit_card_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_card_reward_transactions_id"),
        "credit_card_reward_transactions",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_card_reward_transactions_player_id"),
        "credit_card_reward_transactions",
        ["player_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_card_reward_transactions_purchase_date"),
        "credit_card_reward_transactions",
        ["purchase_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_card_reward_transactions_purchase_id"),
        "credit_card_reward_transactions",
        ["purchase_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_card_reward_transactions_reward_program_id"),
        "credit_card_reward_transactions",
        ["reward_program_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_card_reward_transactions_spending_category_id"),
        "credit_card_reward_transactions",
        ["spending_category_id"],
        unique=False,
    )

    op.execute(
        """
        INSERT INTO credit_card_reward_transactions (
            purchase_id,
            credit_card_id,
            player_id,
            reward_program_id,
            spending_category_id,
            purchase_date,
            qualifying_spend,
            multiplier,
            rewards_earned,
            calculation_source,
            credit_card_product_snapshot,
            notes,
            created_at
        )
        SELECT
            pp.purchase_batch_id,
            pp.credit_card_id,
            COALESCE(pb.player_id, cc.player_id),
            COALESCE(pp.reward_program_id, cc.reward_program_id, rp.id),
            pp.spending_category_id,
            CAST(pb.purchase_date AS DATE),
            pp.amount,
            COALESCE(pp.applied_multiplier, pp.reward_multiplier, cc.rewards_rate, 1),
            COALESCE(pp.calculated_rewards, pp.estimated_rewards_earned, pp.amount * COALESCE(pp.applied_multiplier, pp.reward_multiplier, cc.rewards_rate, 1)),
            CASE
                WHEN pp.calculation_source = 'manual_override' THEN 'manual_override'
                ELSE 'automatic'
            END,
            COALESCE(pp.credit_card_product_snapshot, cc.nickname),
            pp.notes,
            COALESCE(pp.created_at, now())
        FROM purchase_payments pp
        JOIN purchase_batches pb ON pb.id = pp.purchase_batch_id
        JOIN credit_cards cc ON cc.id = pp.credit_card_id
        LEFT JOIN reward_programs rp ON rp.short_code = COALESCE(NULLIF(cc.rewards_type, ''), 'OTHER')
        WHERE pp.payment_type = 'CREDIT_CARD'
          AND pp.credit_card_id IS NOT NULL
          AND COALESCE(pp.calculated_rewards, pp.estimated_rewards_earned) IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_credit_card_reward_transactions_spending_category_id"),
        table_name="credit_card_reward_transactions",
    )
    op.drop_index(
        op.f("ix_credit_card_reward_transactions_reward_program_id"),
        table_name="credit_card_reward_transactions",
    )
    op.drop_index(
        op.f("ix_credit_card_reward_transactions_purchase_id"),
        table_name="credit_card_reward_transactions",
    )
    op.drop_index(
        op.f("ix_credit_card_reward_transactions_purchase_date"),
        table_name="credit_card_reward_transactions",
    )
    op.drop_index(
        op.f("ix_credit_card_reward_transactions_player_id"),
        table_name="credit_card_reward_transactions",
    )
    op.drop_index(
        op.f("ix_credit_card_reward_transactions_id"),
        table_name="credit_card_reward_transactions",
    )
    op.drop_index(
        op.f("ix_credit_card_reward_transactions_credit_card_id"),
        table_name="credit_card_reward_transactions",
    )
    op.drop_table("credit_card_reward_transactions")
