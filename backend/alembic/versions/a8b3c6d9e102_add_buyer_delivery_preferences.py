"""add buyer delivery preferences

Revision ID: a8b3c6d9e102
Revises: f72c9b1d4a88
Create Date: 2026-05-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "a8b3c6d9e102"
down_revision = "f72c9b1d4a88"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "buyers",
        sa.Column(
            "requires_card_images",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "buyers",
        sa.Column(
            "requires_receipt_images",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "buyers",
        sa.Column(
            "preferred_export_type",
            sa.String(length=50),
            nullable=False,
            server_default="CSV",
        ),
    )
    op.alter_column("buyers", "requires_card_images", server_default=None)
    op.alter_column("buyers", "requires_receipt_images", server_default=None)
    op.alter_column("buyers", "preferred_export_type", server_default=None)


def downgrade() -> None:
    op.drop_column("buyers", "preferred_export_type")
    op.drop_column("buyers", "requires_receipt_images")
    op.drop_column("buyers", "requires_card_images")
