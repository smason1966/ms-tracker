"""refine payment account fields

Revision ID: 19c4a7e6b2d5
Revises: 0f6d2c9a4b11
Create Date: 2026-05-22 02:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "19c4a7e6b2d5"
down_revision: Union[str, None] = "0f6d2c9a4b11"
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
        "payment_accounts",
        sa.Column("payment_identifier", sa.String(length=255), nullable=True),
    )
    add_column_if_missing(
        "payment_accounts",
        sa.Column(
            "is_business_account",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    add_column_if_missing(
        "payment_accounts",
        sa.Column("bank_account_type", sa.String(length=50), nullable=True),
    )

    op.execute(
        """
        UPDATE payment_accounts
        SET payment_identifier = account_identifier
        WHERE payment_identifier IS NULL
          AND account_identifier IS NOT NULL
        """
    )
    op.alter_column(
        "payment_accounts",
        "is_business_account",
        server_default=None,
    )


def downgrade() -> None:
    drop_column_if_present("payment_accounts", "bank_account_type")
    drop_column_if_present("payment_accounts", "is_business_account")
    drop_column_if_present("payment_accounts", "payment_identifier")
