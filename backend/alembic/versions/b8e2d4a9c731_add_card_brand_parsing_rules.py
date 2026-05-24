"""add card brand parsing rules

Revision ID: b8e2d4a9c731
Revises: a1c3f5d8e902
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8e2d4a9c731"
down_revision: Union[str, None] = "a1c3f5d8e902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NIKE_CARD_NUMBER_REGEX = (
    r"(?:CARD\s*#?|CARD\s*NUMBER)[^\d]{0,40}((?:\d[\s-]?){12,24})"
)
NIKE_PIN_REGEX = (
    r"(?:PIN|SECURITY\s*CODE|SCRATCH(?:-|\s)?OFF)[^\d]{0,50}(\d{6})"
)
NIKE_PIN_KEYWORDS = "PIN, Security Code, Scratch, Scratch-off"


def has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not has_table("card_brands"):
        return

    if not has_column("card_brands", "card_number_regex"):
        op.add_column("card_brands", sa.Column("card_number_regex", sa.Text(), nullable=True))
    if not has_column("card_brands", "pin_regex"):
        op.add_column("card_brands", sa.Column("pin_regex", sa.Text(), nullable=True))
    if not has_column("card_brands", "pin_label_keywords"):
        op.add_column("card_brands", sa.Column("pin_label_keywords", sa.Text(), nullable=True))
    if not has_column("card_brands", "expected_pin_length"):
        op.add_column("card_brands", sa.Column("expected_pin_length", sa.Integer(), nullable=True))

    bind = op.get_bind()
    nike = bind.execute(
        sa.text("SELECT id FROM card_brands WHERE lower(name) = :name LIMIT 1"),
        {"name": "nike"},
    ).first()

    if nike:
        bind.execute(
            sa.text(
                """
                UPDATE card_brands
                SET card_number_regex = COALESCE(card_number_regex, :card_number_regex),
                    pin_regex = COALESCE(pin_regex, :pin_regex),
                    pin_label_keywords = COALESCE(pin_label_keywords, :pin_label_keywords),
                    expected_pin_length = COALESCE(expected_pin_length, :expected_pin_length),
                    supports_barcode = true
                WHERE id = :id
                """
            ),
            {
                "id": nike.id,
                "card_number_regex": NIKE_CARD_NUMBER_REGEX,
                "pin_regex": NIKE_PIN_REGEX,
                "pin_label_keywords": NIKE_PIN_KEYWORDS,
                "expected_pin_length": 6,
            },
        )
    else:
        bind.execute(
            sa.text(
                """
                INSERT INTO card_brands (
                    name,
                    active,
                    supports_barcode,
                    supports_magstripe,
                    card_number_regex,
                    pin_regex,
                    pin_label_keywords,
                    expected_pin_length,
                    created_at
                )
                VALUES (
                    :name,
                    true,
                    true,
                    false,
                    :card_number_regex,
                    :pin_regex,
                    :pin_label_keywords,
                    :expected_pin_length,
                    CURRENT_TIMESTAMP
                )
                """
            ),
            {
                "name": "Nike",
                "card_number_regex": NIKE_CARD_NUMBER_REGEX,
                "pin_regex": NIKE_PIN_REGEX,
                "pin_label_keywords": NIKE_PIN_KEYWORDS,
                "expected_pin_length": 6,
            },
        )


def downgrade() -> None:
    if not has_table("card_brands"):
        return

    for column_name in (
        "expected_pin_length",
        "pin_label_keywords",
        "pin_regex",
        "card_number_regex",
    ):
        if has_column("card_brands", column_name):
            op.drop_column("card_brands", column_name)
