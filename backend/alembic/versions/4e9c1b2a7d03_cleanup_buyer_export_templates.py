"""cleanup buyer export templates

Revision ID: 4e9c1b2a7d03
Revises: 3d8b2e7f9a11
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "4e9c1b2a7d03"
down_revision: Union[str, None] = "3d8b2e7f9a11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE buyers
            SET card_export_format = COALESCE(card_export_format, payment_timing_notes),
                settlement_behavior_notes = NULL,
                payment_timing_notes = NULL
            WHERE payment_timing_notes IS NOT NULL
              AND payment_timing_notes LIKE '%,%'
              AND (
                lower(payment_timing_notes) LIKE '%card_number%'
                OR lower(payment_timing_notes) LIKE '%face_value%'
                OR lower(payment_timing_notes) LIKE '%pin%'
                OR lower(payment_timing_notes) LIKE '%{card_number}%'
                OR lower(payment_timing_notes) LIKE '%{face_value}%'
                OR lower(payment_timing_notes) LIKE '%{pin}%'
              )
            """
        )
    )


def downgrade() -> None:
    pass
