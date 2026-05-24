"""add gift code parsing templates

Revision ID: ac7e4b1d9f02
Revises: 9b2d7e1c4a08
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ac7e4b1d9f02"
down_revision: Union[str, None] = "9b2d7e1c4a08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UBER_GIFT_CODE_REGEX = (
    r"\b(NAAD[\s-]*[A-Z0-9]{4}[\s-]*[A-Z0-9]{4}[\s-]*[A-Z0-9]{4})\b"
)
DOORDASH_GIFT_CODE_REGEX = (
    r"\b(NAAW[\s-]*[A-Z0-9]{4}[\s-]*[A-Z0-9]{4}[\s-]*[A-Z0-9]{4})\b"
)


def has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def ensure_column(column: sa.Column) -> None:
    if not has_column("card_brands", column.name):
        op.add_column("card_brands", column)


def upsert_gift_code_brand(
    *,
    name: str,
    regex: str,
    prefix: str,
) -> None:
    bind = op.get_bind()
    brand = bind.execute(
        sa.text("SELECT id FROM card_brands WHERE lower(name) = :name LIMIT 1"),
        {"name": name.lower()},
    ).first()

    values = {
        "name": name,
        "regex": regex,
        "prefix": prefix,
        "expected_length": 16,
        "normalization": "uppercase,remove_special_chars",
        "confusion_map": "O=0,I=1,S=5,B=8",
    }

    if brand:
        bind.execute(
            sa.text(
                """
                UPDATE card_brands
                SET gift_code_regex = :regex,
                    gift_code_prefixes = :prefix,
                    gift_code_expected_length = :expected_length,
                    gift_code_normalization = :normalization,
                    ocr_confusion_map = :confusion_map,
                    supports_barcode = false,
                    active = true
                WHERE id = :id
                """
            ),
            {**values, "id": brand.id},
        )
        return

    bind.execute(
        sa.text(
            """
            INSERT INTO card_brands (
                name,
                active,
                supports_barcode,
                supports_magstripe,
                gift_code_regex,
                gift_code_prefixes,
                gift_code_expected_length,
                gift_code_normalization,
                ocr_confusion_map,
                created_at
            )
            VALUES (
                :name,
                true,
                false,
                false,
                :regex,
                :prefix,
                :expected_length,
                :normalization,
                :confusion_map,
                CURRENT_TIMESTAMP
            )
            """
        ),
        values,
    )


def upgrade() -> None:
    if not has_table("card_brands"):
        return

    ensure_column(sa.Column("gift_code_regex", sa.Text(), nullable=True))
    ensure_column(sa.Column("gift_code_prefixes", sa.Text(), nullable=True))
    ensure_column(sa.Column("gift_code_expected_length", sa.Integer(), nullable=True))
    ensure_column(sa.Column("gift_code_normalization", sa.Text(), nullable=True))
    ensure_column(sa.Column("ocr_confusion_map", sa.Text(), nullable=True))

    upsert_gift_code_brand(
        name="Uber",
        regex=UBER_GIFT_CODE_REGEX,
        prefix="NAAD",
    )
    upsert_gift_code_brand(
        name="DoorDash",
        regex=DOORDASH_GIFT_CODE_REGEX,
        prefix="NAAW",
    )


def downgrade() -> None:
    if not has_table("card_brands"):
        return

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE card_brands
            SET gift_code_regex = NULL,
                gift_code_prefixes = NULL,
                gift_code_expected_length = NULL,
                gift_code_normalization = NULL,
                ocr_confusion_map = NULL
            WHERE lower(name) IN ('uber', 'doordash')
            """
        )
    )

    for column_name in (
        "ocr_confusion_map",
        "gift_code_normalization",
        "gift_code_expected_length",
        "gift_code_prefixes",
        "gift_code_regex",
    ):
        if has_column("card_brands", column_name):
            op.drop_column("card_brands", column_name)
