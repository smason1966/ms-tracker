"""add sale payout rates

Revision ID: 2b8f6c1d9a44
Revises: 19c4a7e6b2d5
Create Date: 2026-05-22 02:35:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "2b8f6c1d9a44"
down_revision: Union[str, None] = "19c4a7e6b2d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {
        column["name"] for column in inspector.get_columns(table_name)
    }


def add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if not has_column(table_name, column.name):
        op.add_column(table_name, column)


def drop_column_if_present(table_name: str, column_name: str) -> None:
    if has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def upgrade() -> None:
    add_column_if_missing(
        "sales",
        sa.Column("card_payout_rate", sa.Numeric(8, 4), nullable=True),
    )
    add_column_if_missing(
        "sales",
        sa.Column("fuel_rate_per_1000", sa.Numeric(12, 2), nullable=True),
    )


def downgrade() -> None:
    drop_column_if_present("sales", "fuel_rate_per_1000")
    drop_column_if_present("sales", "card_payout_rate")
