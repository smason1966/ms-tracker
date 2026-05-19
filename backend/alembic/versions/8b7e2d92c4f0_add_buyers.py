"""add buyers

Revision ID: 8b7e2d92c4f0
Revises: 2f6c0a9d8b41
Create Date: 2026-05-18 17:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b7e2d92c4f0'
down_revision: Union[str, Sequence[str], None] = '2f6c0a9d8b41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'buyers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('buyer_type', sa.String(length=50), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    op.create_index(op.f('ix_buyers_id'), 'buyers', ['id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_buyers_id'), table_name='buyers')
    op.drop_table('buyers')
