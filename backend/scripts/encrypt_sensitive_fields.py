#!/usr/bin/env python
"""Encrypt existing plaintext sensitive fields.

Dry-run by default. Run with --apply after setting FIELD_ENCRYPTION_KEY.
This script reports counts only; it never prints credential values.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.session import SessionLocal
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.services.field_encryption import encrypt_field, is_encrypted_field_value


GIFT_CARD_FIELDS = (
    "card_number_encrypted",
    "pin_encrypted",
    "confirmed_card_number",
    "confirmed_pin",
    "confirmed_redemption_code",
)

FUEL_ACCOUNT_FIELDS = ("login_password",)


def needs_encryption(value: str | None) -> bool:
    return bool(value and not is_encrypted_field_value(value))


def encrypt_row_fields(row, fields: tuple[str, ...], *, apply: bool) -> int:
    changed = 0
    for field in fields:
        value = getattr(row, field)
        if needs_encryption(value):
            changed += 1
            if apply:
                setattr(row, field, encrypt_field(value))
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Encrypt plaintext gift card and fuel account credential fields."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write encrypted values. Without this flag, only reports counts.",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        gift_card_field_count = 0
        affected_gift_cards = 0
        for card in db.query(GiftCard).order_by(GiftCard.id.asc()).all():
            changed = encrypt_row_fields(card, GIFT_CARD_FIELDS, apply=args.apply)
            if changed:
                affected_gift_cards += 1
                gift_card_field_count += changed

        fuel_account_field_count = 0
        affected_fuel_accounts = 0
        for account in db.query(FuelRewardAccount).order_by(FuelRewardAccount.id.asc()).all():
            changed = encrypt_row_fields(account, FUEL_ACCOUNT_FIELDS, apply=args.apply)
            if changed:
                affected_fuel_accounts += 1
                fuel_account_field_count += changed

        if args.apply:
            db.commit()
        else:
            db.rollback()

        mode = "APPLY" if args.apply else "DRY RUN"
        print(f"{mode}: gift cards affected: {affected_gift_cards}")
        print(f"{mode}: gift card fields to encrypt: {gift_card_field_count}")
        print(f"{mode}: fuel accounts affected: {affected_fuel_accounts}")
        print(f"{mode}: fuel account fields to encrypt: {fuel_account_field_count}")
        if not args.apply:
            print("No changes written. Set FIELD_ENCRYPTION_KEY and rerun with --apply.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
