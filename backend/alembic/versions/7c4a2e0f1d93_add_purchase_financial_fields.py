"""add purchase financial fields

Revision ID: 7c4a2e0f1d93
Revises: 5e4d1a2c9b80
Create Date: 2026-05-18 18:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c4a2e0f1d93'
down_revision: Union[str, Sequence[str], None] = '5e4d1a2c9b80'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('purchase_batches', sa.Column('purchase_total_paid', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('purchase_batches', sa.Column('sales_tax', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('purchase_batches', sa.Column('activation_fees', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('purchase_batches', sa.Column('discounts', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('purchase_batches', sa.Column('fuel_point_estimated_value', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('purchase_batches', sa.Column('financial_notes', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('purchase_batches', 'financial_notes')
    op.drop_column('purchase_batches', 'fuel_point_estimated_value')
    op.drop_column('purchase_batches', 'discounts')
    op.drop_column('purchase_batches', 'activation_fees')
    op.drop_column('purchase_batches', 'sales_tax')
    op.drop_column('purchase_batches', 'purchase_total_paid')
