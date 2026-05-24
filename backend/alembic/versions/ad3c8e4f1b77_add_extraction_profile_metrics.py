"""add extraction profile metrics

Revision ID: ad3c8e4f1b77
Revises: ac7e4b1d9f02
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ad3c8e4f1b77"
down_revision: Union[str, None] = "ac7e4b1d9f02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if has_table("extraction_profile_metrics"):
        return

    op.create_table(
        "extraction_profile_metrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("extraction_attempt_id", sa.Integer(), nullable=False),
        sa.Column("gift_card_id", sa.Integer(), nullable=False),
        sa.Column("brand", sa.String(length=100), nullable=True),
        sa.Column("profile_key", sa.String(length=100), nullable=False),
        sa.Column("detected_credential_type", sa.String(length=100), nullable=False),
        sa.Column("selected_rotation_degrees", sa.Integer(), nullable=True),
        sa.Column("structured_score", sa.Float(), nullable=True),
        sa.Column("selected_card_number", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("selected_pin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("candidate_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected_candidate_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["extraction_attempt_id"], ["extraction_attempts.id"]),
        sa.ForeignKeyConstraint(["gift_card_id"], ["gift_cards.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_extraction_profile_metrics_id"),
        "extraction_profile_metrics",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_extraction_profile_metrics_brand_profile",
        "extraction_profile_metrics",
        ["brand", "profile_key"],
        unique=False,
    )


def downgrade() -> None:
    if not has_table("extraction_profile_metrics"):
        return

    op.drop_index(
        "ix_extraction_profile_metrics_brand_profile",
        table_name="extraction_profile_metrics",
    )
    op.drop_index(
        op.f("ix_extraction_profile_metrics_id"),
        table_name="extraction_profile_metrics",
    )
    op.drop_table("extraction_profile_metrics")
