"""add fuel rewards

Revision ID: a3f2c94d7b18
Revises: 91d4a9b7c2e1
Create Date: 2026-05-19 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a3f2c94d7b18"
down_revision: Union[str, Sequence[str], None] = "91d4a9b7c2e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "stores",
        sa.Column(
            "earns_fuel_points",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        "stores",
        sa.Column("default_fuel_multiplier", sa.Integer(), nullable=True),
    )
    op.alter_column("stores", "earns_fuel_points", server_default=None)

    op.create_table(
        "fuel_reward_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("retailer", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("alt_id", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("target_points", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_fuel_reward_accounts_id"),
        "fuel_reward_accounts",
        ["id"],
        unique=False,
    )

    op.create_table(
        "fuel_point_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("fuel_reward_account_id", sa.Integer(), nullable=False),
        sa.Column("purchase_batch_id", sa.Integer(), nullable=False),
        sa.Column("earned_date", sa.Date(), nullable=False),
        sa.Column("expires_on", sa.Date(), nullable=False),
        sa.Column("multiplier", sa.Integer(), nullable=True),
        sa.Column("qualifying_spend", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("points_earned", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["fuel_reward_account_id"],
            ["fuel_reward_accounts.id"],
        ),
        sa.ForeignKeyConstraint(["purchase_batch_id"], ["purchase_batches.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_fuel_point_entries_id"),
        "fuel_point_entries",
        ["id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_fuel_point_entries_id"), table_name="fuel_point_entries")
    op.drop_table("fuel_point_entries")
    op.drop_index(
        op.f("ix_fuel_reward_accounts_id"),
        table_name="fuel_reward_accounts",
    )
    op.drop_table("fuel_reward_accounts")
    op.drop_column("stores", "default_fuel_multiplier")
    op.drop_column("stores", "earns_fuel_points")
