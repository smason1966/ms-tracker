"""seed best buy parsing rules

Revision ID: c4d2b8e7a901
Revises: b8e2d4a9c731
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4d2b8e7a901"
down_revision: Union[str, None] = "b8e2d4a9c731"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BEST_BUY_CARD_NUMBER_REGEX = (
    r"(?:CARD\s*#?|CARD\s*NUMBER)[^\d]{0,40}((?:\d[\s-]?){16})"
)
BEST_BUY_PIN_REGEX = r"\bPIN\s*[:#-]?\s*(\d{4})\b"
BEST_BUY_PIN_KEYWORDS = "PIN"

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


def upsert_brand_rules(
    *,
    name: str,
    card_number_regex: str,
    pin_regex: str,
    pin_label_keywords: str,
    expected_pin_length: int,
) -> None:
    bind = op.get_bind()
    brand = bind.execute(
        sa.text("SELECT id FROM card_brands WHERE lower(name) = :name LIMIT 1"),
        {"name": name.lower()},
    ).first()

    if brand:
        bind.execute(
            sa.text(
                """
                UPDATE card_brands
                SET card_number_regex = :card_number_regex,
                    pin_regex = :pin_regex,
                    pin_label_keywords = :pin_label_keywords,
                    expected_pin_length = :expected_pin_length,
                    supports_barcode = true
                WHERE id = :id
                """
            ),
            {
                "id": brand.id,
                "card_number_regex": card_number_regex,
                "pin_regex": pin_regex,
                "pin_label_keywords": pin_label_keywords,
                "expected_pin_length": expected_pin_length,
            },
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
            "name": name,
            "card_number_regex": card_number_regex,
            "pin_regex": pin_regex,
            "pin_label_keywords": pin_label_keywords,
            "expected_pin_length": expected_pin_length,
        },
    )


def upgrade() -> None:
    if not has_table("card_brands"):
        return

    upsert_brand_rules(
        name="Best Buy",
        card_number_regex=BEST_BUY_CARD_NUMBER_REGEX,
        pin_regex=BEST_BUY_PIN_REGEX,
        pin_label_keywords=BEST_BUY_PIN_KEYWORDS,
        expected_pin_length=4,
    )
    upsert_brand_rules(
        name="Nike",
        card_number_regex=NIKE_CARD_NUMBER_REGEX,
        pin_regex=NIKE_PIN_REGEX,
        pin_label_keywords=NIKE_PIN_KEYWORDS,
        expected_pin_length=6,
    )


def downgrade() -> None:
    if not has_table("card_brands"):
        return

    op.get_bind().execute(
        sa.text(
            """
            UPDATE card_brands
            SET card_number_regex = NULL,
                pin_regex = NULL,
                pin_label_keywords = NULL,
                expected_pin_length = NULL
            WHERE lower(name) IN ('best buy', 'nike')
            """
        )
    )
