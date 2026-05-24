"""add buyer zip organization

Revision ID: 6f3c8b1d2a05
Revises: 5f2a9b8c1d04
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "6f3c8b1d2a05"
down_revision: Union[str, None] = "5f2a9b8c1d04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def table_columns(table_name: str) -> set[str]:
    return {
        column["name"]
        for column in inspect(op.get_bind()).get_columns(table_name)
    }


def upgrade() -> None:
    if "zip_organization" not in table_columns("buyers"):
        op.add_column(
            "buyers",
            sa.Column(
                "zip_organization",
                sa.String(length=50),
                server_default="GROUP_BY_BRAND",
                nullable=False,
            ),
        )


def downgrade() -> None:
    if "zip_organization" in table_columns("buyers"):
        op.drop_column("buyers", "zip_organization")
