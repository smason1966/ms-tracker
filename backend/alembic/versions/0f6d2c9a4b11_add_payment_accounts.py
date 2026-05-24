"""add payment accounts

Revision ID: 0f6d2c9a4b11
Revises: bfd2a7e91c44
Create Date: 2026-05-21 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0f6d2c9a4b11"
down_revision: Union[str, Sequence[str], None] = "bfd2a7e91c44"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return False

    return column_name in {
        column["name"] for column in inspector.get_columns(table_name)
    }


def add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if has_table(table_name) and not has_column(table_name, column.name):
        op.add_column(table_name, column)


def drop_column_if_present(table_name: str, column_name: str) -> None:
    if has_table(table_name) and has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def upgrade() -> None:
    if not has_table("payment_accounts"):
        op.create_table(
            "payment_accounts",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("account_type", sa.String(length=50), nullable=False),
            sa.Column("institution", sa.String(length=120), nullable=True),
            sa.Column("last_four", sa.String(length=10), nullable=True),
            sa.Column("account_identifier", sa.String(length=255), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )
        op.create_index(op.f("ix_payment_accounts_id"), "payment_accounts", ["id"], unique=False)
        op.alter_column("payment_accounts", "active", server_default=None)

    add_column_if_missing(
        "buyers",
        sa.Column(
            "default_payment_account_id",
            sa.Integer(),
            sa.ForeignKey("payment_accounts.id"),
            nullable=True,
        ),
    )
    add_column_if_missing("buyers", sa.Column("payment_timing_notes", sa.Text(), nullable=True))
    add_column_if_missing("buyers", sa.Column("payment_reference_format", sa.Text(), nullable=True))
    add_column_if_missing("buyers", sa.Column("payment_instructions", sa.Text(), nullable=True))

    add_column_if_missing(
        "sales",
        sa.Column(
            "payment_account_id",
            sa.Integer(),
            sa.ForeignKey("payment_accounts.id"),
            nullable=True,
        ),
    )
    add_column_if_missing(
        "sale_gift_cards",
        sa.Column(
            "payment_account_id",
            sa.Integer(),
            sa.ForeignKey("payment_accounts.id"),
            nullable=True,
        ),
    )
    add_column_if_missing(
        "sale_fuel_accounts",
        sa.Column(
            "payment_account_id",
            sa.Integer(),
            sa.ForeignKey("payment_accounts.id"),
            nullable=True,
        ),
    )
    add_column_if_missing(
        "gift_cards",
        sa.Column(
            "settlement_payment_account_id",
            sa.Integer(),
            sa.ForeignKey("payment_accounts.id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    drop_column_if_present("gift_cards", "settlement_payment_account_id")
    drop_column_if_present("sale_fuel_accounts", "payment_account_id")
    drop_column_if_present("sale_gift_cards", "payment_account_id")
    drop_column_if_present("sales", "payment_account_id")
    drop_column_if_present("buyers", "payment_instructions")
    drop_column_if_present("buyers", "payment_reference_format")
    drop_column_if_present("buyers", "payment_timing_notes")
    drop_column_if_present("buyers", "default_payment_account_id")

    if has_table("payment_accounts"):
        op.drop_index(op.f("ix_payment_accounts_id"), table_name="payment_accounts")
        op.drop_table("payment_accounts")
