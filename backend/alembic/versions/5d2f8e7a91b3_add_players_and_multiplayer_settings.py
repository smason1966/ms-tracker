"""add players and multiplayer settings

Revision ID: 5d2f8e7a91b3
Revises: 4c8a91d2e6f0
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "5d2f8e7a91b3"
down_revision: Union[str, None] = "4c8a91d2e6f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


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
    if not has_table("players"):
        op.create_table(
            "players",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("label", sa.String(length=20), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("label"),
        )
        op.create_index(op.f("ix_players_id"), "players", ["id"], unique=False)

    if not has_table("app_settings"):
        op.create_table(
            "app_settings",
            sa.Column("key", sa.String(length=120), nullable=False),
            sa.Column("value", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("key"),
        )

    add_column_if_missing(
        "credit_cards",
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("players.id"), nullable=True),
    )
    add_column_if_missing(
        "purchase_batches",
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("players.id"), nullable=True),
    )


def downgrade() -> None:
    drop_column_if_present("purchase_batches", "player_id")
    drop_column_if_present("credit_cards", "player_id")
    if has_table("app_settings"):
        op.drop_table("app_settings")
    if has_table("players"):
        op.drop_index(op.f("ix_players_id"), table_name="players")
        op.drop_table("players")
