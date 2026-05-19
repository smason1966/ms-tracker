"""add gift card verification fields

Revision ID: d2b8f6c4a901
Revises: c5a9f2d1e4b6
Create Date: 2026-05-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2b8f6c4a901"
down_revision: Union[str, Sequence[str], None] = "c5a9f2d1e4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "gift_cards",
        sa.Column("verified_balance", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "gift_cards",
        sa.Column("verified_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "gift_cards",
        sa.Column("verification_notes", sa.Text(), nullable=True),
    )
    op.add_column(
        "gift_cards",
        sa.Column("verification_source", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "gift_cards",
        sa.Column(
            "verification_status",
            sa.String(length=50),
            server_default="PENDING",
            nullable=False,
        ),
    )
    op.execute(
        """
        UPDATE gift_cards
        SET verification_status = 'VERIFIED',
            verified_at = updated_at
        WHERE status = 'VERIFIED_AVAILABLE'
        """
    )
    op.alter_column("gift_cards", "verification_status", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("gift_cards", "verification_status")
    op.drop_column("gift_cards", "verification_source")
    op.drop_column("gift_cards", "verification_notes")
    op.drop_column("gift_cards", "verified_at")
    op.drop_column("gift_cards", "verified_balance")
