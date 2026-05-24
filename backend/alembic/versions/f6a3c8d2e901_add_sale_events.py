"""add sale events

Revision ID: f6a3c8d2e901
Revises: d91e4a7b2c60
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a3c8d2e901"
down_revision: Union[str, None] = "d91e4a7b2c60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if not has_table("sale_events"):
        op.create_table(
            "sale_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("sale_id", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(length=100), nullable=False),
            sa.Column("affected_asset_count", sa.Integer(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["sale_id"], ["sales.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_sale_events_id"), "sale_events", ["id"], unique=False)
        op.create_index(op.f("ix_sale_events_sale_id"), "sale_events", ["sale_id"], unique=False)


def downgrade() -> None:
    if has_table("sale_events"):
        op.drop_index(op.f("ix_sale_events_sale_id"), table_name="sale_events")
        op.drop_index(op.f("ix_sale_events_id"), table_name="sale_events")
        op.drop_table("sale_events")
