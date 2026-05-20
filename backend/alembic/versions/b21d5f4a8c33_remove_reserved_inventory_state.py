"""remove reserved inventory state

Revision ID: b21d5f4a8c33
Revises: ab12c4d8e901
Create Date: 2026-05-19 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "b21d5f4a8c33"
down_revision: Union[str, Sequence[str], None] = "ab12c4d8e901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE gift_cards SET status = 'VERIFIED_AVAILABLE' WHERE status = 'RESERVED'"
    )


def downgrade() -> None:
    pass
