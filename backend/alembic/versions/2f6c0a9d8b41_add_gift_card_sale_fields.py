"""add gift card sale fields

Revision ID: 2f6c0a9d8b41
Revises: f07cbbc66e99
Create Date: 2026-05-18 17:39:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f6c0a9d8b41'
down_revision: Union[str, Sequence[str], None] = 'f07cbbc66e99'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('gift_cards', sa.Column('sold_to', sa.String(length=255), nullable=True))
    op.add_column('gift_cards', sa.Column('sold_date', sa.Date(), nullable=True))
    op.add_column('gift_cards', sa.Column('sale_price', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('gift_cards', sa.Column('sale_notes', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('gift_cards', 'sale_notes')
    op.drop_column('gift_cards', 'sale_price')
    op.drop_column('gift_cards', 'sold_date')
    op.drop_column('gift_cards', 'sold_to')
