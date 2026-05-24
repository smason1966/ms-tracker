"""Normalize duplicate test gift card numbers before uniqueness enforcement.

Run from the backend container/project with:
    python -m scripts.normalize_duplicate_gift_cards --dry-run
    python -m scripts.normalize_duplicate_gift_cards
"""

from __future__ import annotations

import argparse
from collections import defaultdict

from sqlalchemy import func

from app.db.session import SessionLocal
from app.models.buyer import Buyer as _Buyer
from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch as _PurchaseBatch


_REFERENCED_MODELS = (_Buyer, _PurchaseBatch)


BLOCKED_STATUSES = {"SOLD", "SOLD_PENDING_PAYMENT", "SETTLED", "REDEEMED"}
NORMALIZATION_NOTE = "Test duplicate card number normalized"


def normalize_card_number(value: str | None) -> str | None:
    if value is None:
        return None

    normalized_value = value.strip()
    return normalized_value or None


def fake_card_number(card_id: int, original_number: str) -> str:
    digits = "".join(character for character in original_number if character.isdigit())
    last_four = digits[-4:] if len(digits) >= 4 else str(card_id).zfill(4)[-4:]
    return f"TEST-DUP-{card_id}-{last_four}"


def append_note(existing_note: str | None) -> str:
    if existing_note and NORMALIZATION_NOTE in existing_note:
        return existing_note

    return (
        f"{existing_note}\n{NORMALIZATION_NOTE}"
        if existing_note
        else NORMALIZATION_NOTE
    )


def find_duplicate_groups(db) -> dict[tuple[str, str], list[GiftCard]]:
    cards = (
        db.query(GiftCard)
        .filter(GiftCard.card_number_encrypted.isnot(None))
        .filter(func.trim(GiftCard.card_number_encrypted) != "")
        .order_by(GiftCard.brand.asc(), GiftCard.card_number_encrypted.asc(), GiftCard.id.asc())
        .all()
    )
    groups: dict[tuple[str, str], list[GiftCard]] = defaultdict(list)

    for card in cards:
        card_number = normalize_card_number(card.card_number_encrypted)

        if card_number:
            groups[(card.brand, card_number)].append(card)

    return {
        key: grouped_cards
        for key, grouped_cards in groups.items()
        if len(grouped_cards) > 1
    }


def print_remaining_duplicate_check(db) -> None:
    rows = (
        db.query(
            GiftCard.brand,
            GiftCard.card_number_encrypted,
            func.count(GiftCard.id).label("duplicate_count"),
        )
        .filter(GiftCard.card_number_encrypted.isnot(None))
        .filter(func.trim(GiftCard.card_number_encrypted) != "")
        .group_by(GiftCard.brand, GiftCard.card_number_encrypted)
        .having(func.count(GiftCard.id) > 1)
        .order_by(GiftCard.brand.asc(), GiftCard.card_number_encrypted.asc())
        .all()
    )

    print("Remaining duplicate brand/card_number combinations:")
    if not rows:
        print("  none")
        return

    for brand, card_number, duplicate_count in rows:
        print(f"  {brand} / {card_number}: {duplicate_count}")


def run(include_sold: bool, dry_run: bool) -> None:
    db = SessionLocal()
    duplicates_found = 0
    cards_updated = 0
    cards_skipped = 0

    try:
        duplicate_groups = find_duplicate_groups(db)
        duplicates_found = len(duplicate_groups)

        for (brand, card_number), cards in duplicate_groups.items():
            keeper = cards[0]
            print(
                f"Duplicate group {brand} / {card_number}: "
                f"keeping card #{keeper.id}"
            )

            for card in cards[1:]:
                if card.status in BLOCKED_STATUSES and not include_sold:
                    cards_skipped += 1
                    print(f"  skipped card #{card.id} ({card.status})")
                    continue

                replacement_number = fake_card_number(card.id, card_number)
                print(f"  card #{card.id}: {card_number} -> {replacement_number}")

                if not dry_run:
                    card.card_number_encrypted = replacement_number

                    if normalize_card_number(card.detected_card_number) == card_number:
                        card.detected_card_number = replacement_number

                    card.notes = append_note(card.notes)

                cards_updated += 1

        if not dry_run:
            db.commit()

        print("")
        print(f"Duplicate groups found: {duplicates_found}")
        print(f"Cards updated: {cards_updated}")
        print(f"Cards skipped: {cards_skipped}")
        print("")
        print_remaining_duplicate_check(db)
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Normalize duplicate gift card numbers in test data.",
    )
    parser.add_argument(
        "--include-sold",
        action="store_true",
        help="Also modify SOLD/SETTLED/REDEEMED records.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned changes without committing.",
    )
    args = parser.parse_args()

    run(include_sold=args.include_sold, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
