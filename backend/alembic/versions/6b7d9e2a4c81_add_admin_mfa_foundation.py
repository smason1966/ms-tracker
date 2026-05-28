"""add admin mfa foundation

Revision ID: 6b7d9e2a4c81
Revises: 4c2e9a1b7d30
Create Date: 2026-05-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "6b7d9e2a4c81"
down_revision: str | Sequence[str] | None = "4c2e9a1b7d30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "admin_users",
        sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("admin_users", sa.Column("totp_secret_encrypted", sa.Text(), nullable=True))
    op.add_column("admin_users", sa.Column("pending_totp_secret_encrypted", sa.Text(), nullable=True))
    op.add_column("admin_users", sa.Column("mfa_enabled_at", sa.DateTime(), nullable=True))
    op.add_column("admin_users", sa.Column("mfa_updated_at", sa.DateTime(), nullable=True))
    op.add_column("admin_users", sa.Column("mfa_last_used_at", sa.DateTime(), nullable=True))

    op.create_table(
        "admin_mfa_recovery_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_user_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(length=512), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_admin_mfa_recovery_codes_admin_user_id"),
        "admin_mfa_recovery_codes",
        ["admin_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_admin_mfa_recovery_codes_id"),
        "admin_mfa_recovery_codes",
        ["id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_admin_mfa_recovery_codes_id"), table_name="admin_mfa_recovery_codes")
    op.drop_index(
        op.f("ix_admin_mfa_recovery_codes_admin_user_id"),
        table_name="admin_mfa_recovery_codes",
    )
    op.drop_table("admin_mfa_recovery_codes")

    op.drop_column("admin_users", "mfa_last_used_at")
    op.drop_column("admin_users", "mfa_updated_at")
    op.drop_column("admin_users", "mfa_enabled_at")
    op.drop_column("admin_users", "pending_totp_secret_encrypted")
    op.drop_column("admin_users", "totp_secret_encrypted")
    op.drop_column("admin_users", "mfa_enabled")
