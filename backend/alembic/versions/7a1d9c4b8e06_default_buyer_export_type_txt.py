"""default buyer exports to txt

Revision ID: 7a1d9c4b8e06
Revises: 6f3c8b1d2a05
Create Date: 2026-05-22 00:00:00.000000
"""

from alembic import op


revision = "7a1d9c4b8e06"
down_revision = "6f3c8b1d2a05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE buyers ALTER COLUMN preferred_export_type SET DEFAULT 'TXT'")
    op.execute(
        """
        UPDATE buyers
        SET preferred_export_type = 'TXT'
        WHERE preferred_export_type IS NULL
           OR preferred_export_type = 'CSV'
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE buyers ALTER COLUMN preferred_export_type SET DEFAULT 'CSV'")
    op.execute(
        """
        UPDATE buyers
        SET preferred_export_type = 'CSV'
        WHERE preferred_export_type = 'TXT'
        """
    )
