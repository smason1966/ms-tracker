"""add fuel sale overage fields

Revision ID: 4c8a91d2e6f0
Revises: 2b8f6c1d9a44
Create Date: 2026-05-21 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4c8a91d2e6f0"
down_revision: Union[str, None] = "2b8f6c1d9a44"
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
        "sale_fuel_accounts",
        sa.Column(
            "fuel_overage_override",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    add_column_if_missing(
        "sale_fuel_accounts",
        sa.Column("overage_points", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    drop_column_if_present("sale_fuel_accounts", "overage_points")
    drop_column_if_present("sale_fuel_accounts", "fuel_overage_override")
