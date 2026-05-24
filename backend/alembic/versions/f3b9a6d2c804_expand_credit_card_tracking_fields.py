"""expand credit card tracking fields

Revision ID: f3b9a6d2c804
Revises: f2a4c8d9b501
Create Date: 2026-05-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "f3b9a6d2c804"
down_revision = "f2a4c8d9b501"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_cards", sa.Column("statement_balance", sa.Numeric(12, 2), nullable=True))
    op.add_column("credit_cards", sa.Column("available_credit", sa.Numeric(12, 2), nullable=True))
    op.add_column("credit_cards", sa.Column("reported_utilization", sa.Numeric(8, 4), nullable=True))
    op.add_column("credit_cards", sa.Column("minimum_payment_due", sa.Numeric(12, 2), nullable=True))
    op.add_column("credit_cards", sa.Column("payment_due_date", sa.Date(), nullable=True))
    op.add_column("credit_cards", sa.Column("next_statement_close_date", sa.Date(), nullable=True))
    op.add_column("credit_cards", sa.Column("preferred_utilization", sa.Numeric(8, 4), nullable=True))
    op.add_column("credit_cards", sa.Column("apr", sa.Numeric(8, 4), nullable=True))
    op.add_column("credit_cards", sa.Column("payment_options", sa.Text(), nullable=True))
    op.add_column("credit_cards", sa.Column("date_last_used", sa.Date(), nullable=True))
    op.add_column("credit_cards", sa.Column("date_last_product_change", sa.Date(), nullable=True))
    op.add_column("credit_cards", sa.Column("date_closed", sa.Date(), nullable=True))
    op.add_column("credit_cards", sa.Column("date_last_cli", sa.Date(), nullable=True))
    op.add_column(
        "credit_cards",
        sa.Column("reports_to_ex", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "credit_cards",
        sa.Column("reports_to_tu", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "credit_cards",
        sa.Column("reports_to_eq", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("credit_cards", "reports_to_ex", server_default=None)
    op.alter_column("credit_cards", "reports_to_tu", server_default=None)
    op.alter_column("credit_cards", "reports_to_eq", server_default=None)


def downgrade() -> None:
    op.drop_column("credit_cards", "reports_to_eq")
    op.drop_column("credit_cards", "reports_to_tu")
    op.drop_column("credit_cards", "reports_to_ex")
    op.drop_column("credit_cards", "date_last_cli")
    op.drop_column("credit_cards", "date_closed")
    op.drop_column("credit_cards", "date_last_product_change")
    op.drop_column("credit_cards", "date_last_used")
    op.drop_column("credit_cards", "payment_options")
    op.drop_column("credit_cards", "apr")
    op.drop_column("credit_cards", "preferred_utilization")
    op.drop_column("credit_cards", "next_statement_close_date")
    op.drop_column("credit_cards", "payment_due_date")
    op.drop_column("credit_cards", "minimum_payment_due")
    op.drop_column("credit_cards", "reported_utilization")
    op.drop_column("credit_cards", "available_credit")
    op.drop_column("credit_cards", "statement_balance")
