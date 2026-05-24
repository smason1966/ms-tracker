"""refine reward programs

Revision ID: 7b2e1c4d9f03
Revises: 6a9f1d2c3b80
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7b2e1c4d9f03"
down_revision: Union[str, None] = "6a9f1d2c3b80"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SPECIFIC_PROGRAMS = [
    ("American Airlines AAdvantage", "AA", "Airline Miles", None, False),
    ("United MileagePlus", "UA", "Airline Miles", None, False),
    ("Alaska Mileage Plan", "AS", "Airline Miles", None, False),
    ("Delta SkyMiles", "DL", "Airline Miles", None, False),
    ("Hilton Honors", "HH", "Hotel Points", None, False),
    ("World of Hyatt", "HYATT", "Hotel Points", None, False),
    ("Marriott Bonvoy", "BONVOY", "Hotel Points", None, False),
]


KROGER_FAMILY_STORES = [
    "Kroger",
    "Fred Meyer",
    "Harris Teeter",
    "King Soopers",
    "Ralphs",
    "Smith's",
    "Fry's",
    "QFC",
]


def has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    if not has_column("credit_card_reward_rules", "reward_program_id"):
        op.add_column(
            "credit_card_reward_rules",
            sa.Column("reward_program_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_credit_card_reward_rules_reward_program_id_reward_programs",
            "credit_card_reward_rules",
            "reward_programs",
            ["reward_program_id"],
            ["id"],
        )

    if not has_column("stores", "reward_program_id"):
        op.add_column(
            "stores",
            sa.Column("reward_program_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_stores_reward_program_id_reward_programs",
            "stores",
            "reward_programs",
            ["reward_program_id"],
            ["id"],
        )

    program_table = sa.table(
        "reward_programs",
        sa.column("name", sa.String),
        sa.column("short_code", sa.String),
        sa.column("category", sa.String),
        sa.column("estimated_value_cents_per_point", sa.Numeric),
        sa.column("transferable", sa.Boolean),
        sa.column("active", sa.Boolean),
    )
    existing_codes = {
        row.short_code
        for row in conn.execute(sa.text("SELECT short_code FROM reward_programs"))
    }
    new_programs = [
        {
            "name": name,
            "short_code": code,
            "category": category,
            "estimated_value_cents_per_point": value,
            "transferable": transferable,
            "active": True,
        }
        for name, code, category, value, transferable in SPECIFIC_PROGRAMS
        if code not in existing_codes
    ]

    if new_programs:
        op.bulk_insert(program_table, new_programs)

    conn.execute(
        sa.text(
            "UPDATE reward_programs "
            "SET name = 'Kroger Family Fuel Points', category = 'Fuel Rewards', active = true "
            "WHERE short_code = 'KROGER_FUEL'"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE reward_programs "
            "SET name = 'Generic Airline Miles', active = false "
            "WHERE short_code = 'MILES'"
        )
    )

    code_to_id = {
        row.short_code: row.id
        for row in conn.execute(sa.text("SELECT id, short_code FROM reward_programs"))
    }
    kroger_id = code_to_id.get("KROGER_FUEL")
    fred_meyer_id = code_to_id.get("FM_FUEL")

    if kroger_id is not None and fred_meyer_id is not None:
        for table_name in ("credit_cards", "purchase_payments", "credit_card_reward_rules"):
            if has_column(table_name, "reward_program_id"):
                conn.execute(
                    sa.text(
                        f"UPDATE {table_name} SET reward_program_id = :kroger_id "
                        "WHERE reward_program_id = :fred_meyer_id"
                    ),
                    {"kroger_id": kroger_id, "fred_meyer_id": fred_meyer_id},
                )
        conn.execute(
            sa.text("DELETE FROM reward_programs WHERE short_code = 'FM_FUEL'")
        )

    if has_column("credit_card_reward_rules", "reward_program_id"):
        conn.execute(
            sa.text(
                "UPDATE credit_card_reward_rules AS rules "
                "SET reward_program_id = cards.reward_program_id "
                "FROM credit_cards AS cards "
                "WHERE rules.credit_card_id = cards.id "
                "AND rules.reward_program_id IS NULL"
            )
        )

    if kroger_id is not None:
        for store_name in KROGER_FAMILY_STORES:
            conn.execute(
                sa.text(
                    "UPDATE stores SET reward_program_id = :program_id "
                    "WHERE lower(name) = lower(:store_name)"
                ),
                {"program_id": kroger_id, "store_name": store_name},
            )


def downgrade() -> None:
    if has_column("stores", "reward_program_id"):
        op.drop_constraint(
            "fk_stores_reward_program_id_reward_programs",
            "stores",
            type_="foreignkey",
        )
        op.drop_column("stores", "reward_program_id")

    if has_column("credit_card_reward_rules", "reward_program_id"):
        op.drop_constraint(
            "fk_credit_card_reward_rules_reward_program_id_reward_programs",
            "credit_card_reward_rules",
            type_="foreignkey",
        )
        op.drop_column("credit_card_reward_rules", "reward_program_id")

    conn = op.get_bind()
    for _, code, _, _, _ in SPECIFIC_PROGRAMS:
        conn.execute(
            sa.text("DELETE FROM reward_programs WHERE short_code = :code"),
            {"code": code},
        )
