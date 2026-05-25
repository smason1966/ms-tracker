"""add confirmed gift card credentials

Revision ID: f41c8a72d903
Revises: 2e7b9c4d1a63, e0c9a7d6b521
Create Date: 2026-05-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "f41c8a72d903"
down_revision: Union[str, Sequence[str], None] = (
    "2e7b9c4d1a63",
    "e0c9a7d6b521",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS confirmed_card_number TEXT")
    op.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS confirmed_pin TEXT")
    op.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS confirmed_redemption_code TEXT")
    op.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP")
    op.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS confirmed_source VARCHAR(100)")
    op.execute(
        """
        UPDATE gift_cards
        SET confirmed_card_number = card_number_encrypted
        WHERE confirmed_card_number IS NULL
          AND card_number_encrypted IS NOT NULL
          AND trim(card_number_encrypted) != ''
        """
    )
    op.execute(
        """
        UPDATE gift_cards
        SET confirmed_pin = pin_encrypted
        WHERE confirmed_pin IS NULL
          AND pin_encrypted IS NOT NULL
          AND trim(pin_encrypted) != ''
        """
    )
    op.execute(
        """
        UPDATE gift_cards
        SET confirmed_at = verified_at
        WHERE confirmed_at IS NULL
          AND verified_at IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE gift_cards
        SET confirmed_source = COALESCE(verification_source, 'legacy_verified')
        WHERE confirmed_source IS NULL
          AND (confirmed_card_number IS NOT NULL OR confirmed_pin IS NOT NULL)
        """
    )


def downgrade() -> None:
    op.drop_column("gift_cards", "confirmed_source")
    op.drop_column("gift_cards", "confirmed_at")
    op.drop_column("gift_cards", "confirmed_redemption_code")
    op.drop_column("gift_cards", "confirmed_pin")
    op.drop_column("gift_cards", "confirmed_card_number")
