"""add reward programs

Revision ID: 6a9f1d2c3b80
Revises: 5d2f8e7a91b3
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "6a9f1d2c3b80"
down_revision: Union[str, None] = "5d2f8e7a91b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_PROGRAMS = [
    ("Cashback", "CASH", "Cashback", None, False),
    ("Chase Ultimate Rewards", "UR", "Transferable Points", None, True),
    ("Amex Membership Rewards", "MR", "Transferable Points", None, True),
    ("Citi ThankYou", "TY", "Transferable Points", None, True),
    ("Capital One Miles", "C1", "Transferable Points", None, True),
    ("Airline Miles", "MILES", "Airline Miles", None, False),
    ("Other", "OTHER", "Other", None, False),
    ("Kroger Fuel Points", "KROGER_FUEL", "Fuel Rewards", None, False),
    ("Fred Meyer Fuel Points", "FM_FUEL", "Fuel Rewards", None, False),
]


def has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not has_table("reward_programs"):
        op.create_table(
            "reward_programs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("short_code", sa.String(length=40), nullable=False),
            sa.Column("category", sa.String(length=80), nullable=False),
            sa.Column("estimated_value_cents_per_point", sa.Numeric(10, 4), nullable=True),
            sa.Column("transferable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("short_code"),
        )
        op.create_index(op.f("ix_reward_programs_id"), "reward_programs", ["id"], unique=False)

    if not has_column("credit_cards", "reward_program_id"):
        op.add_column(
            "credit_cards",
            sa.Column("reward_program_id", sa.Integer(), sa.ForeignKey("reward_programs.id"), nullable=True),
        )

    if not has_column("purchase_payments", "reward_program_id"):
        op.add_column(
            "purchase_payments",
            sa.Column("reward_program_id", sa.Integer(), sa.ForeignKey("reward_programs.id"), nullable=True),
        )

    programs_table = sa.table(
        "reward_programs",
        sa.column("name", sa.String),
        sa.column("short_code", sa.String),
        sa.column("category", sa.String),
        sa.column("estimated_value_cents_per_point", sa.Numeric),
        sa.column("transferable", sa.Boolean),
        sa.column("active", sa.Boolean),
    )
    conn = op.get_bind()
    existing_codes = {row[0] for row in conn.execute(sa.text("SELECT short_code FROM reward_programs"))}
    rows = [
        {
            "name": name,
            "short_code": code,
            "category": category,
            "estimated_value_cents_per_point": value,
            "transferable": transferable,
            "active": True,
        }
        for name, code, category, value, transferable in DEFAULT_PROGRAMS
        if code not in existing_codes
    ]
    if rows:
        op.bulk_insert(programs_table, rows)

    code_to_id = {
        row.short_code: row.id
        for row in conn.execute(sa.text("SELECT id, short_code FROM reward_programs"))
    }
    legacy_map = {
        "CASHBACK": "CASH",
        "CASH": "CASH",
        "UR": "UR",
        "MR": "MR",
        "TY": "TY",
        "MILES": "MILES",
        "OTHER": "OTHER",
    }
    for legacy_type, code in legacy_map.items():
        program_id = code_to_id.get(code)
        if program_id is None:
            continue
        conn.execute(
            sa.text(
                "UPDATE credit_cards SET reward_program_id = :program_id "
                "WHERE reward_program_id IS NULL AND rewards_type = :legacy_type"
            ),
            {"program_id": program_id, "legacy_type": legacy_type},
        )
        conn.execute(
            sa.text(
                "UPDATE purchase_payments SET reward_program_id = :program_id "
                "WHERE reward_program_id IS NULL AND rewards_type = :legacy_type"
            ),
            {"program_id": program_id, "legacy_type": legacy_type},
        )


def downgrade() -> None:
    if has_column("purchase_payments", "reward_program_id"):
        op.drop_column("purchase_payments", "reward_program_id")
    if has_column("credit_cards", "reward_program_id"):
        op.drop_column("credit_cards", "reward_program_id")
    if has_table("reward_programs"):
        op.drop_index(op.f("ix_reward_programs_id"), table_name="reward_programs")
        op.drop_table("reward_programs")
