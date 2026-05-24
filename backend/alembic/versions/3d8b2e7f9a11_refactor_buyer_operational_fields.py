"""refactor buyer operational fields

Revision ID: 3d8b2e7f9a11
Revises: f6a3c8d2e901
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text


revision: str = "3d8b2e7f9a11"
down_revision: Union[str, None] = "f6a3c8d2e901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def table_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if column.name not in table_columns(table_name):
        op.add_column(table_name, column)


def table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(table_name)


def looks_like_card_export_template(value: str | None) -> bool:
    if not value:
        return False

    normalized = value.lower()
    if "," not in normalized:
        return False

    export_tokens = (
        "brand",
        "face_value",
        "card_number",
        "pin",
        "{brand}",
        "{face_value}",
        "{card_number}",
        "{pin}",
    )
    return any(token in normalized for token in export_tokens)


def upgrade() -> None:
    add_column_if_missing("buyers", sa.Column("buyer_category", sa.String(length=50), nullable=True))
    add_column_if_missing("buyers", sa.Column("preferred_contact_method", sa.String(length=50), nullable=True))
    add_column_if_missing("buyers", sa.Column("contact_handle", sa.String(length=255), nullable=True))
    add_column_if_missing("buyers", sa.Column("backup_contact", sa.String(length=255), nullable=True))
    add_column_if_missing("buyers", sa.Column("expected_payment_reference", sa.Text(), nullable=True))
    add_column_if_missing("buyers", sa.Column("settlement_behavior_notes", sa.Text(), nullable=True))
    add_column_if_missing(
        "buyers",
        sa.Column("group_card_exports_by_brand", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    add_column_if_missing(
        "buyers",
        sa.Column("preserve_blank_export_columns", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )

    if not table_exists("buyer_external_identifiers"):
        op.create_table(
            "buyer_external_identifiers",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("buyer_id", sa.Integer(), nullable=False),
            sa.Column("platform_source", sa.String(length=100), nullable=False),
            sa.Column("identifier", sa.String(length=255), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["buyer_id"], ["buyers.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_buyer_external_identifiers_id"),
            "buyer_external_identifiers",
            ["id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_buyer_external_identifiers_buyer_id"),
            "buyer_external_identifiers",
            ["buyer_id"],
            unique=False,
        )

    connection = op.get_bind()
    rows = connection.execute(
        text(
            """
            SELECT id, buyer_type, contact_email, payment_timing_notes,
                   payment_reference_format, card_export_format
            FROM buyers
            """
        )
    ).mappings()

    for row in rows:
        values: dict[str, object] = {
            "id": row["id"],
            "buyer_category": row["buyer_type"],
            "preferred_contact_method": "Email" if row["contact_email"] else None,
            "contact_handle": row["contact_email"],
            "expected_payment_reference": row["payment_reference_format"],
            "settlement_behavior_notes": row["payment_timing_notes"],
            "card_export_format": row["card_export_format"],
        }

        if (
            looks_like_card_export_template(row["payment_timing_notes"])
        ):
            if not row["card_export_format"]:
                values["card_export_format"] = row["payment_timing_notes"]
            values["settlement_behavior_notes"] = None

        connection.execute(
            text(
                """
                UPDATE buyers
                SET buyer_category = COALESCE(buyer_category, :buyer_category),
                    preferred_contact_method = COALESCE(preferred_contact_method, :preferred_contact_method),
                    contact_handle = COALESCE(contact_handle, :contact_handle),
                    expected_payment_reference = COALESCE(expected_payment_reference, :expected_payment_reference),
                    settlement_behavior_notes = COALESCE(settlement_behavior_notes, :settlement_behavior_notes),
                    card_export_format = COALESCE(card_export_format, :card_export_format)
                WHERE id = :id
                """
            ),
            values,
        )


def downgrade() -> None:
    if table_exists("buyer_external_identifiers"):
        op.drop_index(op.f("ix_buyer_external_identifiers_buyer_id"), table_name="buyer_external_identifiers")
        op.drop_index(op.f("ix_buyer_external_identifiers_id"), table_name="buyer_external_identifiers")
        op.drop_table("buyer_external_identifiers")

    columns = table_columns("buyers")
    for column_name in (
        "preserve_blank_export_columns",
        "group_card_exports_by_brand",
        "settlement_behavior_notes",
        "expected_payment_reference",
        "backup_contact",
        "contact_handle",
        "preferred_contact_method",
        "buyer_category",
    ):
        if column_name in columns:
            op.drop_column("buyers", column_name)
