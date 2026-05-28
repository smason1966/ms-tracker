"""add admin user roles

Revision ID: 9d4e7b2c1a63
Revises: 8c1e7a5b2d90
Create Date: 2026-05-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "9d4e7b2c1a63"
down_revision: str | Sequence[str] | None = "8c1e7a5b2d90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "admin_users",
        sa.Column("role", sa.String(length=50), server_default="admin", nullable=False),
    )
    op.execute("UPDATE admin_users SET role = 'admin' WHERE role IS NULL")


def downgrade() -> None:
    op.drop_column("admin_users", "role")
