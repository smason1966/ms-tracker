"""add card brand spatial parsing rules

Revision ID: d91e4a7b2c60
Revises: c4d2b8e7a901
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d91e4a7b2c60"
down_revision: Union[str, None] = "c4d2b8e7a901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not has_table("card_brands"):
        return

    if not has_column("card_brands", "card_number_source_priority"):
        op.add_column(
            "card_brands",
            sa.Column("card_number_source_priority", sa.String(length=100), nullable=True),
        )

    if not has_column("card_brands", "pin_spatial_rule"):
        op.add_column(
            "card_brands",
            sa.Column("pin_spatial_rule", sa.String(length=100), nullable=True),
        )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE card_brands
            SET card_number_source_priority = 'barcode,ocr',
                pin_spatial_rule = 'four_digits_right_of_card_number',
                expected_pin_length = 4
            WHERE lower(name) = 'best buy'
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE card_brands
            SET pin_spatial_rule = 'six_digits_near_scratch_box',
                expected_pin_length = 6
            WHERE lower(name) = 'nike'
            """
        )
    )


def downgrade() -> None:
    if not has_table("card_brands"):
        return

    if has_column("card_brands", "pin_spatial_rule"):
        op.drop_column("card_brands", "pin_spatial_rule")

    if has_column("card_brands", "card_number_source_priority"):
        op.drop_column("card_brands", "card_number_source_priority")
