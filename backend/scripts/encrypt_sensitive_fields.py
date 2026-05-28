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


def initialize_model_registry() -> None:
    """Import all mapped models so SQLAlchemy can resolve relationships/FKs."""
    import app.models.admin_mfa_challenge  # noqa: F401
    import app.models.admin_mfa_recovery_code  # noqa: F401
    import app.models.admin_user  # noqa: F401
    import app.models.app_setting  # noqa: F401
    import app.models.attachment  # noqa: F401
    import app.models.buyer  # noqa: F401
    import app.models.card_brand  # noqa: F401
    import app.models.card_image  # noqa: F401
    import app.models.card_issuer  # noqa: F401
    import app.models.card_network  # noqa: F401
    import app.models.credit_card  # noqa: F401
    import app.models.credit_card_product_change  # noqa: F401
    import app.models.credit_card_reward_rule  # noqa: F401
    import app.models.credit_card_reward_transaction  # noqa: F401
    import app.models.extraction_attempt  # noqa: F401
    import app.models.extraction_candidate  # noqa: F401
    import app.models.extraction_profile_metric  # noqa: F401
    import app.models.fuel_point_entry  # noqa: F401
    import app.models.fuel_reward_account  # noqa: F401
    import app.models.gift_card  # noqa: F401
    import app.models.payment_account  # noqa: F401
    import app.models.player  # noqa: F401
    import app.models.purchase_batch  # noqa: F401
    import app.models.purchase_payment  # noqa: F401
    import app.models.receipt  # noqa: F401
    import app.models.reward_program  # noqa: F401
    import app.models.sale  # noqa: F401
    import app.models.sale_event  # noqa: F401
    import app.models.sale_fuel_account  # noqa: F401
    import app.models.sale_gift_card  # noqa: F401
    import app.models.spending_category  # noqa: F401
    import app.models.store  # noqa: F401


initialize_model_registry()

from app.db.session import SessionLocal
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_candidate import ExtractionCandidate
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.services.field_encryption import encrypt_field, is_encrypted_field_value


GIFT_CARD_FIELDS = (
    "card_number_encrypted",
    "pin_encrypted",
    "confirmed_card_number",
    "confirmed_pin",
    "confirmed_redemption_code",
    "detected_card_number",
    "detected_pin",
)

FUEL_ACCOUNT_FIELDS = ("login_password",)

EXTRACTION_ATTEMPT_FIELDS = (
    "extracted_card_number",
    "extracted_pin",
    "raw_text",
)

EXTRACTION_CANDIDATE_FIELDS = (
    "value",
    "notes",
)


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
        for account in (
            db.query(FuelRewardAccount)
            .order_by(FuelRewardAccount.id.asc())
            .all()
        ):
            changed = encrypt_row_fields(account, FUEL_ACCOUNT_FIELDS, apply=args.apply)
            if changed:
                affected_fuel_accounts += 1
                fuel_account_field_count += changed

        extraction_attempt_field_count = 0
        affected_extraction_attempts = 0
        for attempt in (
            db.query(ExtractionAttempt)
            .order_by(ExtractionAttempt.id.asc())
            .all()
        ):
            changed = encrypt_row_fields(
                attempt,
                EXTRACTION_ATTEMPT_FIELDS,
                apply=args.apply,
            )
            if changed:
                affected_extraction_attempts += 1
                extraction_attempt_field_count += changed

        extraction_candidate_field_count = 0
        affected_extraction_candidates = 0
        for candidate in (
            db.query(ExtractionCandidate)
            .order_by(ExtractionCandidate.id.asc())
            .all()
        ):
            changed = encrypt_row_fields(
                candidate,
                EXTRACTION_CANDIDATE_FIELDS,
                apply=args.apply,
            )
            if changed:
                affected_extraction_candidates += 1
                extraction_candidate_field_count += changed

        if args.apply:
            db.commit()
        else:
            db.rollback()

        mode = "APPLY" if args.apply else "DRY RUN"
        print(f"{mode}: gift cards affected: {affected_gift_cards}")
        print(f"{mode}: gift card fields to encrypt: {gift_card_field_count}")
        print(f"{mode}: fuel accounts affected: {affected_fuel_accounts}")
        print(f"{mode}: fuel account fields to encrypt: {fuel_account_field_count}")
        print(f"{mode}: extraction attempts affected: {affected_extraction_attempts}")
        print(
            f"{mode}: extraction attempt fields to encrypt: "
            f"{extraction_attempt_field_count}"
        )
        print(f"{mode}: extraction candidates affected: {affected_extraction_candidates}")
        print(
            f"{mode}: extraction candidate fields to encrypt: "
            f"{extraction_candidate_field_count}"
        )
        if not args.apply:
            print("No changes written. Set FIELD_ENCRYPTION_KEY and rerun with --apply.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
