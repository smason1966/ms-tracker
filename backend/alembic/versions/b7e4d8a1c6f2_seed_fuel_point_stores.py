"""seed fuel point stores

Revision ID: b7e4d8a1c6f2
Revises: a3f2c94d7b18
Create Date: 2026-05-19 09:25:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b7e4d8a1c6f2"
down_revision: Union[str, Sequence[str], None] = "a3f2c94d7b18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        UPDATE stores
        SET earns_fuel_points = true,
            default_fuel_multiplier = COALESCE(default_fuel_multiplier, 4)
        WHERE lower(name) IN ('kroger', 'fred meyer', 'fredmeyer')
           OR lower(name) LIKE 'kroger %'
           OR lower(name) LIKE 'fred meyer %'
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        """
        UPDATE stores
        SET earns_fuel_points = false,
            default_fuel_multiplier = NULL
        WHERE lower(name) IN ('kroger', 'fred meyer', 'fredmeyer')
           OR lower(name) LIKE 'kroger %'
           OR lower(name) LIKE 'fred meyer %'
        """
    )
