"""cleanup voided sale assets

Revision ID: 5f2a9b8c1d04
Revises: 4e9c1b2a7d03
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "5f2a9b8c1d04"
down_revision: Union[str, None] = "4e9c1b2a7d03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE gift_cards AS gc
            SET status = CASE
                    WHEN gc.card_number_encrypted IS NOT NULL
                         AND gc.card_number_encrypted <> ''
                    THEN 'VERIFIED_AVAILABLE'
                    ELSE 'NEEDS_VERIFICATION'
                END,
                buyer_id = NULL,
                sold_to = NULL,
                sold_at = NULL,
                sold_date = NULL,
                expected_payment_date = NULL,
                expected_payout = NULL,
                sale_price = NULL,
                sale_notes = NULL,
                payout_received = NULL,
                settlement_payment_account_id = NULL,
                settlement_received_at = NULL,
                updated_at = NOW()
            FROM sale_gift_cards AS sgc
            JOIN sales AS s ON s.id = sgc.sale_id
            WHERE sgc.gift_card_id = gc.id
              AND s.status = 'VOIDED'
              AND NOT EXISTS (
                SELECT 1
                FROM sale_gift_cards AS active_sgc
                JOIN sales AS active_sale ON active_sale.id = active_sgc.sale_id
                WHERE active_sgc.gift_card_id = gc.id
                  AND active_sale.status <> 'VOIDED'
              )
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE fuel_reward_accounts AS account
            SET status = 'ACTIVE',
                buyer_id = NULL,
                sold_to = NULL,
                sold_date = NULL,
                expected_payment_date = NULL,
                sale_price = NULL,
                sale_notes = NULL,
                updated_at = NOW()
            FROM sale_fuel_accounts AS link
            JOIN sales AS s ON s.id = link.sale_id
            WHERE link.fuel_reward_account_id = account.id
              AND s.status = 'VOIDED'
              AND NOT EXISTS (
                SELECT 1
                FROM sale_fuel_accounts AS active_link
                JOIN sales AS active_sale ON active_sale.id = active_link.sale_id
                WHERE active_link.fuel_reward_account_id = account.id
                  AND active_sale.status <> 'VOIDED'
              )
            """
        )
    )


def downgrade() -> None:
    pass
