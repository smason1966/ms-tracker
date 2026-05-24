"""add card brand magstripe metadata

Revision ID: c9e4d7f1a203
Revises: b4c7e2f9a901
Create Date: 2026-05-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "c9e4d7f1a203"
down_revision = "b4c7e2f9a901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "card_brands",
        sa.Column("supports_barcode", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "card_brands",
        sa.Column("supports_magstripe", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "card_brands",
        sa.Column("magstripe_parser_type", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "card_brands",
        sa.Column("magstripe_parser_notes", sa.Text(), nullable=True),
    )
    op.add_column(
        "card_brands",
        sa.Column("sample_magstripe_data", sa.Text(), nullable=True),
    )
    op.alter_column("card_brands", "supports_barcode", server_default=None)
    op.alter_column("card_brands", "supports_magstripe", server_default=None)


def downgrade() -> None:
    op.drop_column("card_brands", "sample_magstripe_data")
    op.drop_column("card_brands", "magstripe_parser_notes")
    op.drop_column("card_brands", "magstripe_parser_type")
    op.drop_column("card_brands", "supports_magstripe")
    op.drop_column("card_brands", "supports_barcode")
