"""add admin mfa challenges

Revision ID: 8c1e7a5b2d90
Revises: 6b7d9e2a4c81
Create Date: 2026-05-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "8c1e7a5b2d90"
down_revision: str | Sequence[str] | None = "6b7d9e2a4c81"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_mfa_challenges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_user_id", sa.Integer(), nullable=False),
        sa.Column("challenge_token_hash", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("challenge_token_hash", name="uq_admin_mfa_challenges_token_hash"),
    )
    op.create_index(op.f("ix_admin_mfa_challenges_admin_user_id"), "admin_mfa_challenges", ["admin_user_id"], unique=False)
    op.create_index(op.f("ix_admin_mfa_challenges_challenge_token_hash"), "admin_mfa_challenges", ["challenge_token_hash"], unique=False)
    op.create_index(op.f("ix_admin_mfa_challenges_expires_at"), "admin_mfa_challenges", ["expires_at"], unique=False)
    op.create_index(op.f("ix_admin_mfa_challenges_id"), "admin_mfa_challenges", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_admin_mfa_challenges_id"), table_name="admin_mfa_challenges")
    op.drop_index(op.f("ix_admin_mfa_challenges_expires_at"), table_name="admin_mfa_challenges")
    op.drop_index(op.f("ix_admin_mfa_challenges_challenge_token_hash"), table_name="admin_mfa_challenges")
    op.drop_index(op.f("ix_admin_mfa_challenges_admin_user_id"), table_name="admin_mfa_challenges")
    op.drop_table("admin_mfa_challenges")
