"""add export formats and fuel password

Revision ID: e63b8d2f91a4
Revises: d48a13f2b7c6
Create Date: 2026-05-20 05:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e63b8d2f91a4"
down_revision: Union[str, Sequence[str], None] = "d48a13f2b7c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("buyers", sa.Column("card_export_format", sa.Text(), nullable=True))
    op.add_column("buyers", sa.Column("fuel_export_format", sa.Text(), nullable=True))
    op.add_column("fuel_reward_accounts", sa.Column("login_password", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("fuel_reward_accounts", "login_password")
    op.drop_column("buyers", "fuel_export_format")
    op.drop_column("buyers", "card_export_format")
