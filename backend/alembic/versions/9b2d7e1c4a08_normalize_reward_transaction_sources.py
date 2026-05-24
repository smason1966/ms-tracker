"""normalize reward transaction sources

Revision ID: 9b2d7e1c4a08
Revises: 8f1c2d4e6a90
Create Date: 2026-05-22 00:00:00.000000
"""

from alembic import op


revision = "9b2d7e1c4a08"
down_revision = "8f1c2d4e6a90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE credit_card_reward_transactions
        SET calculation_source = 'automatic'
        WHERE calculation_source NOT IN ('manual_override', 'product_change_snapshot')
        """
    )


def downgrade() -> None:
    pass
