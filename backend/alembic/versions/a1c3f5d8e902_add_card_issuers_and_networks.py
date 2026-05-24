"""add card issuers and networks

Revision ID: a1c3f5d8e902
Revises: 9d1a7c4e2f56
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1c3f5d8e902"
down_revision: Union[str, None] = "9d1a7c4e2f56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


issuer_table = sa.table(
    "card_issuers",
    sa.column("id", sa.Integer),
    sa.column("name", sa.String),
    sa.column("short_name", sa.String),
    sa.column("active", sa.Boolean),
    sa.column("issuer_type", sa.String),
)

network_table = sa.table(
    "card_networks",
    sa.column("id", sa.Integer),
    sa.column("name", sa.String),
    sa.column("code", sa.String),
    sa.column("active", sa.Boolean),
)


DEFAULT_ISSUERS = [
    ("Chase", "Chase", "bank"),
    ("American Express", "Amex", "bank"),
    ("Capital One", "Capital One", "bank"),
    ("Citi", "Citi", "bank"),
    ("Discover", "Discover", "bank"),
    ("Barclays", "Barclays", "bank"),
    ("Bank of America", "BofA", "bank"),
    ("Wells Fargo", "Wells Fargo", "bank"),
    ("US Bank", "US Bank", "bank"),
    ("Synchrony", "Synchrony", "retail"),
    ("Comenity", "Comenity", "retail"),
    ("FNBO", "FNBO", "bank"),
    ("Bread Financial", "Bread", "retail"),
]

DEFAULT_NETWORKS = [
    ("Visa", "VISA"),
    ("Mastercard", "MASTERCARD"),
    ("American Express", "AMEX"),
    ("Discover", "DISCOVER"),
    ("Diners Club", "DINERS"),
    ("JCB", "JCB"),
    ("UnionPay", "UNIONPAY"),
    ("Other", "OTHER"),
]


def has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def normalized(value: str | None) -> str:
    return (value or "").strip().lower()


def upgrade() -> None:
    bind = op.get_bind()

    if not has_table("card_issuers"):
        op.create_table(
            "card_issuers",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("short_name", sa.String(length=60), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("website", sa.String(length=255), nullable=True),
            sa.Column("support_phone", sa.String(length=60), nullable=True),
            sa.Column("issuer_type", sa.String(length=50), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )
        op.create_index(op.f("ix_card_issuers_id"), "card_issuers", ["id"], unique=False)

    if not has_table("card_networks"):
        op.create_table(
            "card_networks",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column("code", sa.String(length=40), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("code"),
            sa.UniqueConstraint("name"),
        )
        op.create_index(op.f("ix_card_networks_id"), "card_networks", ["id"], unique=False)

    for name, short_name, issuer_type in DEFAULT_ISSUERS:
        existing = bind.execute(
            sa.text("select id from card_issuers where lower(name) = lower(:name)"),
            {"name": name},
        ).first()
        if not existing:
            bind.execute(
                sa.text(
                    "insert into card_issuers (name, short_name, active, issuer_type, created_at, updated_at) "
                    "values (:name, :short_name, true, :issuer_type, now(), now())"
                ),
                {"name": name, "short_name": short_name, "issuer_type": issuer_type},
            )

    for name, code in DEFAULT_NETWORKS:
        existing = bind.execute(
            sa.text("select id from card_networks where lower(name) = lower(:name) or lower(code) = lower(:code)"),
            {"name": name, "code": code},
        ).first()
        if not existing:
            bind.execute(
                sa.text(
                    "insert into card_networks (name, code, active, created_at, updated_at) "
                    "values (:name, :code, true, now(), now())"
                ),
                {"name": name, "code": code},
            )

    if not has_column("credit_cards", "issuer_id"):
        op.add_column("credit_cards", sa.Column("issuer_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_credit_cards_issuer_id_card_issuers",
            "credit_cards",
            "card_issuers",
            ["issuer_id"],
            ["id"],
        )

    if not has_column("credit_cards", "network_id"):
        op.add_column("credit_cards", sa.Column("network_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_credit_cards_network_id_card_networks",
            "credit_cards",
            "card_networks",
            ["network_id"],
            ["id"],
        )

    issuer_rows = bind.execute(sa.text("select id, name from card_issuers")).fetchall()
    issuer_lookup = {normalized(row.name): row.id for row in issuer_rows}
    network_rows = bind.execute(sa.text("select id, name, code from card_networks")).fetchall()
    network_lookup = {normalized(row.name): row.id for row in network_rows}
    network_lookup.update({normalized(row.code): row.id for row in network_rows})

    cards = bind.execute(sa.text("select id, issuer, network from credit_cards")).fetchall()
    for card in cards:
        issuer_id = issuer_lookup.get(normalized(card.issuer))
        if not issuer_id and card.issuer:
            result = bind.execute(
                sa.text(
                    "insert into card_issuers (name, active, issuer_type, created_at, updated_at) "
                    "values (:name, true, 'other', now(), now()) returning id"
                ),
                {"name": card.issuer.strip()},
            )
            issuer_id = result.scalar_one()
            issuer_lookup[normalized(card.issuer)] = issuer_id

        network_key = normalized(card.network)
        if network_key in {"amex", "american express"}:
            network_key = "american express"
        elif network_key in {"master card", "mastercard", "mc"}:
            network_key = "mastercard"
        network_id = network_lookup.get(network_key)
        if not network_id and card.network:
            result = bind.execute(
                sa.text(
                    "insert into card_networks (name, code, active, created_at, updated_at) "
                    "values (:name, :code, true, now(), now()) returning id"
                ),
                {"name": card.network.strip(), "code": card.network.strip().upper().replace(" ", "_")},
            )
            network_id = result.scalar_one()
            network_lookup[normalized(card.network)] = network_id

        bind.execute(
            sa.text("update credit_cards set issuer_id = :issuer_id, network_id = :network_id where id = :card_id"),
            {"issuer_id": issuer_id, "network_id": network_id, "card_id": card.id},
        )


def downgrade() -> None:
    if has_column("credit_cards", "network_id"):
        op.drop_constraint("fk_credit_cards_network_id_card_networks", "credit_cards", type_="foreignkey")
        op.drop_column("credit_cards", "network_id")
    if has_column("credit_cards", "issuer_id"):
        op.drop_constraint("fk_credit_cards_issuer_id_card_issuers", "credit_cards", type_="foreignkey")
        op.drop_column("credit_cards", "issuer_id")
    if has_table("card_networks"):
        op.drop_index(op.f("ix_card_networks_id"), table_name="card_networks")
        op.drop_table("card_networks")
    if has_table("card_issuers"):
        op.drop_index(op.f("ix_card_issuers_id"), table_name="card_issuers")
        op.drop_table("card_issuers")
