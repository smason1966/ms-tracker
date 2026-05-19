"""add gift card acquisition cost

Revision ID: 5e4d1a2c9b80
Revises: 8b7e2d92c4f0
Create Date: 2026-05-18 18:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5e4d1a2c9b80'
down_revision: Union[str, Sequence[str], None] = '8b7e2d92c4f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('gift_cards', sa.Column('acquisition_cost', sa.Numeric(precision=12, scale=2), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('gift_cards', 'acquisition_cost')
