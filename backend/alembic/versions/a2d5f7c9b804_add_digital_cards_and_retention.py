"""add digital cards and attachment retention

Revision ID: a2d5f7c9b804
Revises: f41c8a72d903
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa


revision = "a2d5f7c9b804"
down_revision = "f41c8a72d903"
branch_labels = None
depends_on = None


def add_column_if_missing(table_name: str, column: sa.Column) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {item["name"] for item in inspector.get_columns(table_name)}
    if column.name not in columns:
        op.add_column(table_name, column)


def upgrade() -> None:
    add_column_if_missing(
        "gift_cards",
        sa.Column("card_source", sa.String(length=50), server_default="physical", nullable=False),
    )
    add_column_if_missing("gift_cards", sa.Column("digital_source_notes", sa.Text(), nullable=True))

    for table_name, path_column in [("card_images", "original_image_url"), ("receipts", "image_url")]:
        if table_name == "card_images":
            add_column_if_missing(table_name, sa.Column("original_filename", sa.String(length=255), nullable=True))
        add_column_if_missing(table_name, sa.Column("attachment_type", sa.String(length=50), server_default="card_image" if table_name == "card_images" else "receipt_image", nullable=False))
        add_column_if_missing(table_name, sa.Column("uploaded_at", sa.DateTime(), nullable=True))
        add_column_if_missing(table_name, sa.Column("retention_until", sa.DateTime(), nullable=True))
        add_column_if_missing(table_name, sa.Column("retention_status", sa.String(length=50), server_default="active", nullable=False))
        add_column_if_missing(table_name, sa.Column("retain_attachment", sa.Boolean(), server_default=sa.text("false"), nullable=False))
        add_column_if_missing(table_name, sa.Column("purged_at", sa.DateTime(), nullable=True))
        add_column_if_missing(table_name, sa.Column("purge_metadata", sa.Text(), nullable=True))

    op.execute(
        "UPDATE gift_cards SET card_source = 'physical' WHERE card_source IS NULL OR trim(card_source) = ''"
    )
    op.execute(
        "UPDATE card_images SET uploaded_at = COALESCE(uploaded_at, created_at), attachment_type = COALESCE(attachment_type, 'card_image'), retention_status = COALESCE(retention_status, 'active')"
    )
    op.execute(
        "UPDATE receipts SET uploaded_at = COALESCE(uploaded_at, created_at), attachment_type = COALESCE(attachment_type, 'receipt_image'), retention_status = COALESCE(retention_status, 'active')"
    )

    inspector = sa.inspect(op.get_bind())
    if "attachment_retention_events" not in inspector.get_table_names():
        op.create_table(
            "attachment_retention_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("attachment_table", sa.String(length=50), nullable=False),
            sa.Column("attachment_id", sa.Integer(), nullable=False),
            sa.Column("attachment_type", sa.String(length=50), nullable=True),
            sa.Column("action", sa.String(length=50), nullable=False),
            sa.Column("file_path", sa.String(length=500), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("metadata", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    pass
