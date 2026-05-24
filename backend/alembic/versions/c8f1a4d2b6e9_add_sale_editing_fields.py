"""add sale editing fields

Revision ID: c8f1a4d2b6e9
Revises: ad3c8e4f1b77
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c8f1a4d2b6e9"
down_revision: Union[str, None] = "ad3c8e4f1b77"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sales",
        sa.Column("expected_payment_date", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "sales",
        sa.Column("buyer_reference", sa.String(length=255), nullable=True),
    )
    op.add_column("sales", sa.Column("internal_tags", sa.Text(), nullable=True))
    op.add_column(
        "sales",
        sa.Column("export_profile", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "sales",
        sa.Column("settlement_status_notes", sa.Text(), nullable=True),
    )
    op.add_column(
        "sales",
        sa.Column("manual_payout_override_amount", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "sales",
        sa.Column("linked_external_reference_ids", sa.Text(), nullable=True),
    )
    op.add_column(
        "sale_events",
        sa.Column("user_label", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "sale_events",
        sa.Column("field_name", sa.String(length=100), nullable=True),
    )
    op.add_column("sale_events", sa.Column("old_value", sa.Text(), nullable=True))
    op.add_column("sale_events", sa.Column("new_value", sa.Text(), nullable=True))
    op.add_column("sale_events", sa.Column("reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("sale_events", "reason")
    op.drop_column("sale_events", "new_value")
    op.drop_column("sale_events", "old_value")
    op.drop_column("sale_events", "field_name")
    op.drop_column("sale_events", "user_label")
    op.drop_column("sales", "linked_external_reference_ids")
    op.drop_column("sales", "manual_payout_override_amount")
    op.drop_column("sales", "settlement_status_notes")
    op.drop_column("sales", "export_profile")
    op.drop_column("sales", "internal_tags")
    op.drop_column("sales", "buyer_reference")
    op.drop_column("sales", "expected_payment_date")
