"""add transfer import metadata

Revision ID: 9d1a7c4e2f56
Revises: 8c4f1a2d6b90
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9d1a7c4e2f56"
down_revision: Union[str, None] = "8c4f1a2d6b90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    for table_name in ["purchase_batches", "gift_cards", "sales"]:
        if not has_column(table_name, "imported_from_environment"):
            op.add_column(table_name, sa.Column("imported_from_environment", sa.String(length=100), nullable=True))
        if not has_column(table_name, "imported_source_id"):
            op.add_column(table_name, sa.Column("imported_source_id", sa.String(length=100), nullable=True))
        if not has_column(table_name, "imported_at"):
            op.add_column(table_name, sa.Column("imported_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    for table_name in ["sales", "gift_cards", "purchase_batches"]:
        for column_name in ["imported_at", "imported_source_id", "imported_from_environment"]:
            if has_column(table_name, column_name):
                op.drop_column(table_name, column_name)
