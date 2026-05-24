"""add card and store categories

Revision ID: ab9d2e7c5f41
Revises: f3b9a6d2c804
Create Date: 2026-05-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "ab9d2e7c5f41"
down_revision = "f3b9a6d2c804"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_cards", sa.Column("category_tags", sa.Text(), nullable=True))
    op.add_column("stores", sa.Column("merchant_category", sa.String(length=100), nullable=True))
    op.execute("UPDATE stores SET merchant_category = 'grocery' WHERE lower(name) IN ('fred meyer', 'kroger', 'king soopers', 'fry''s', 'qfc', 'ralphs', 'smith''s')")
    op.execute("UPDATE stores SET merchant_category = 'wholesale' WHERE lower(name) = 'costco'")
    op.execute("UPDATE stores SET merchant_category = 'office_supply' WHERE lower(name) = 'office depot'")


def downgrade() -> None:
    op.drop_column("stores", "merchant_category")
    op.drop_column("credit_cards", "category_tags")
