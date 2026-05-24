"""add buyer reporting fields

Revision ID: f72c9b1d4a88
Revises: e63b8d2f91a4
Create Date: 2026-05-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "f72c9b1d4a88"
down_revision = "e63b8d2f91a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("buyers", sa.Column("contact_email", sa.String(length=255), nullable=True))
    op.add_column("buyers", sa.Column("default_payout_days", sa.Integer(), nullable=True))
    op.add_column("buyers", sa.Column("default_payout_rate", sa.Numeric(8, 4), nullable=True))
    op.add_column("fuel_reward_accounts", sa.Column("expected_payment_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("fuel_reward_accounts", "expected_payment_date")
    op.drop_column("buyers", "default_payout_rate")
    op.drop_column("buyers", "default_payout_days")
    op.drop_column("buyers", "contact_email")
