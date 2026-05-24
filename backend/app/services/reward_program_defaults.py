from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.reward_program import RewardProgram


CARD_ELIGIBLE_REWARD_CATEGORIES = {
    "Cashback",
    "Transferable Points",
    "Airline Miles",
    "Hotel Points",
    "Crypto",
}

DEFAULT_REWARD_PROGRAM_VALUES: dict[str, Decimal] = {
    "CASH": Decimal("1.0000"),
    "UR": Decimal("1.5000"),
    "MR": Decimal("1.5000"),
    "TY": Decimal("1.3000"),
    "C1": Decimal("1.0000"),
    "AA": Decimal("1.4000"),
    "UA": Decimal("1.3000"),
    "AS": Decimal("1.5000"),
    "DL": Decimal("1.1000"),
    "MILES": Decimal("1.2000"),
    "HH": Decimal("0.5000"),
    "HYATT": Decimal("1.7000"),
    "BONVOY": Decimal("0.8000"),
    "KROGER_FUEL": Decimal("1.0000"),
    "OTHER": Decimal("1.0000"),
    "BTC": Decimal("0.0000"),
    "ETH": Decimal("0.0000"),
    "USDC": Decimal("100.0000"),
    "GEMINI": Decimal("0.0000"),
    "COINBASE": Decimal("0.0000"),
    "CRYPTOCOM": Decimal("0.0000"),
    "OTHER_CRYPTO": Decimal("0.0000"),
}

DEFAULT_REWARD_PROGRAMS: list[dict] = [
    {
        "name": "Cashback",
        "short_code": "CASH",
        "category": "Cashback",
        "estimated_value_cents_per_point": Decimal("1.0000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "Chase Ultimate Rewards",
        "short_code": "UR",
        "category": "Transferable Points",
        "estimated_value_cents_per_point": Decimal("1.5000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": None,
    },
    {
        "name": "Amex Membership Rewards",
        "short_code": "MR",
        "category": "Transferable Points",
        "estimated_value_cents_per_point": Decimal("1.5000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": None,
    },
    {
        "name": "Citi ThankYou",
        "short_code": "TY",
        "category": "Transferable Points",
        "estimated_value_cents_per_point": Decimal("1.3000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": None,
    },
    {
        "name": "Capital One Miles",
        "short_code": "C1",
        "category": "Transferable Points",
        "estimated_value_cents_per_point": Decimal("1.0000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": None,
    },
    {
        "name": "Generic Airline Miles",
        "short_code": "MILES",
        "category": "Airline Miles",
        "estimated_value_cents_per_point": Decimal("1.2000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": False,
        "active": False,
        "notes": None,
    },
    {
        "name": "Other",
        "short_code": "OTHER",
        "category": "Other",
        "estimated_value_cents_per_point": Decimal("1.0000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": False,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "Kroger Family Fuel Points",
        "short_code": "KROGER_FUEL",
        "category": "Fuel Rewards",
        "estimated_value_cents_per_point": Decimal("1.0000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": False,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "American Airlines AAdvantage",
        "short_code": "AA",
        "category": "Airline Miles",
        "estimated_value_cents_per_point": Decimal("1.4000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "United MileagePlus",
        "short_code": "UA",
        "category": "Airline Miles",
        "estimated_value_cents_per_point": Decimal("1.3000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "Alaska Mileage Plan",
        "short_code": "AS",
        "category": "Airline Miles",
        "estimated_value_cents_per_point": Decimal("1.5000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "Delta SkyMiles",
        "short_code": "DL",
        "category": "Airline Miles",
        "estimated_value_cents_per_point": Decimal("1.1000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "Hilton Honors",
        "short_code": "HH",
        "category": "Hotel Points",
        "estimated_value_cents_per_point": Decimal("0.5000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "World of Hyatt",
        "short_code": "HYATT",
        "category": "Hotel Points",
        "estimated_value_cents_per_point": Decimal("1.7000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "Marriott Bonvoy",
        "short_code": "BONVOY",
        "category": "Hotel Points",
        "estimated_value_cents_per_point": Decimal("0.8000"),
        "value_unit": "cents_per_point",
        "eligible_for_credit_cards": True,
        "transferable": False,
        "notes": None,
    },
    {
        "name": "Bitcoin",
        "short_code": "BTC",
        "category": "Crypto",
        "estimated_value_cents_per_point": Decimal("0.0000"),
        "value_unit": "variable",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": "Crypto reward token. Market value varies.",
    },
    {
        "name": "Ethereum",
        "short_code": "ETH",
        "category": "Crypto",
        "estimated_value_cents_per_point": Decimal("0.0000"),
        "value_unit": "variable",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": "Crypto reward token. Market value varies.",
    },
    {
        "name": "USDC",
        "short_code": "USDC",
        "category": "Crypto",
        "estimated_value_cents_per_point": Decimal("100.0000"),
        "value_unit": "usd_per_token",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": "Stablecoin reward token.",
    },
    {
        "name": "Gemini Rewards",
        "short_code": "GEMINI",
        "category": "Crypto",
        "estimated_value_cents_per_point": Decimal("0.0000"),
        "value_unit": "variable",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": "Crypto rewards program. Token value varies.",
    },
    {
        "name": "Coinbase Rewards",
        "short_code": "COINBASE",
        "category": "Crypto",
        "estimated_value_cents_per_point": Decimal("0.0000"),
        "value_unit": "variable",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": "Crypto rewards program. Token value varies.",
    },
    {
        "name": "Crypto.com Rewards",
        "short_code": "CRYPTOCOM",
        "category": "Crypto",
        "estimated_value_cents_per_point": Decimal("0.0000"),
        "value_unit": "variable",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": "Crypto rewards program. Token value varies.",
    },
    {
        "name": "Other Crypto",
        "short_code": "OTHER_CRYPTO",
        "category": "Crypto",
        "estimated_value_cents_per_point": Decimal("0.0000"),
        "value_unit": "variable",
        "eligible_for_credit_cards": True,
        "transferable": True,
        "notes": "Catch-all crypto reward program.",
    },
]


def ensure_reward_program_schema(db: Session) -> None:
    db.execute(
        text(
            "ALTER TABLE reward_programs "
            "ADD COLUMN IF NOT EXISTS value_unit VARCHAR(50)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE reward_programs "
            "ADD COLUMN IF NOT EXISTS eligible_for_credit_cards BOOLEAN"
        )
    )
    db.execute(
        text(
            "UPDATE reward_programs "
            "SET eligible_for_credit_cards = "
            "CASE WHEN category IN ('Cashback', 'Transferable Points', 'Airline Miles', "
            "'Hotel Points', 'Crypto') THEN true ELSE false END "
            "WHERE eligible_for_credit_cards IS NULL"
        )
    )
    db.execute(
        text(
            "ALTER TABLE reward_programs "
            "ALTER COLUMN eligible_for_credit_cards SET DEFAULT true"
        )
    )
    db.execute(
        text(
            "ALTER TABLE reward_programs "
            "ALTER COLUMN eligible_for_credit_cards SET NOT NULL"
        )
    )


def default_value_unit(short_code: str) -> str:
    if short_code in {
        "BTC",
        "ETH",
        "GEMINI",
        "COINBASE",
        "CRYPTOCOM",
        "OTHER_CRYPTO",
    }:
        return "variable"
    if short_code == "USDC":
        return "usd_per_token"
    return "cents_per_point"


def default_credit_card_eligibility(category: str) -> bool:
    return category in CARD_ELIGIBLE_REWARD_CATEGORIES


def ensure_default_reward_program_values(db: Session) -> None:
    ensure_reward_program_schema(db)

    existing_codes = {
        program.short_code
        for program in db.query(RewardProgram)
        .filter(
            RewardProgram.short_code.in_(
                [program["short_code"] for program in DEFAULT_REWARD_PROGRAMS]
            )
        )
        .all()
    }

    for default_program in DEFAULT_REWARD_PROGRAMS:
        if default_program["short_code"] in existing_codes:
            continue
        db.add(
            RewardProgram(
                active=default_program.get("active", True),
                **{
                    key: value
                    for key, value in default_program.items()
                    if key != "active"
                },
            )
        )

    programs = (
        db.query(RewardProgram)
        .filter(RewardProgram.short_code.in_(DEFAULT_REWARD_PROGRAM_VALUES.keys()))
        .filter(RewardProgram.estimated_value_cents_per_point.is_(None))
        .all()
    )

    for program in programs:
        program.estimated_value_cents_per_point = DEFAULT_REWARD_PROGRAM_VALUES[
            program.short_code
        ]

    programs_missing_units = (
        db.query(RewardProgram)
        .filter(RewardProgram.value_unit.is_(None))
        .all()
    )
    for program in programs_missing_units:
        program.value_unit = default_value_unit(program.short_code)

    for program in db.query(RewardProgram).all():
        if program.category == "Fuel Rewards" and program.eligible_for_credit_cards:
            program.eligible_for_credit_cards = False

    db.flush()
