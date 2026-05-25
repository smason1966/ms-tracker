#!/usr/bin/env python3
import argparse
import csv
import sys
from decimal import Decimal
from pathlib import Path

from sqlalchemy import bindparam, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal, engine


engine.echo = False


PREMIUM_TERMS = ("premium", "fee", "activation", "shipping", "surcharge")


REPORT_SQL = text(
    """
    select
      gc.id as card_id,
      gc.brand,
      gc.face_value,
      gc.acquisition_cost as old_acquisition_cost,
      gc.face_value as proposed_acquisition_cost,
      gc.purchase_batch_id,
      pb.store_name,
      pb.purchase_total_paid,
      sg.sale_id,
      gc.expected_payout,
      (gc.expected_payout - gc.acquisition_cost) as profit_before,
      (gc.expected_payout - gc.face_value) as profit_after,
      gc.status,
      gc.notes,
      gc.internal_notes
    from gift_cards gc
    left join purchase_batches pb on pb.id = gc.purchase_batch_id
    left join (
      select gift_card_id, min(sale_id) as sale_id
      from sale_gift_cards
      group by gift_card_id
    ) sg on sg.gift_card_id = gc.id
    where gc.acquisition_cost > gc.face_value
    order by gc.purchase_batch_id, gc.id
    """
)


UPDATE_SQL = text(
    """
    update gift_cards
    set acquisition_cost = face_value,
        updated_at = CURRENT_TIMESTAMP
    where id in :card_ids
      and acquisition_cost > face_value
    """
).bindparams(bindparam("card_ids", expanding=True))


def decimal_value(value) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def has_premium_note(row: dict) -> bool:
    note_text = " ".join(
        str(value or "")
        for value in (row.get("notes"), row.get("internal_notes"))
    ).lower()
    return any(term in note_text for term in PREMIUM_TERMS)


def parse_ids(values: list[str]) -> set[int]:
    ids: set[int] = set()
    for value in values:
        for part in value.split(","):
            stripped = part.strip()
            if stripped:
                ids.add(int(stripped))
    return ids


def parse_csv_ids(path: str | None) -> set[int]:
    if not path:
        return set()

    ids: set[int] = set()
    with Path(path).open(newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        for row in reader:
            raw_id = row.get("card_id") or row.get("id")
            if raw_id:
                ids.add(int(raw_id))
    return ids


def print_report(rows: list[dict]) -> None:
    if not rows:
        print("No gift cards found with acquisition_cost > face_value.")
        return

    fieldnames = [
        "card_id",
        "brand",
        "face_value",
        "old_acquisition_cost",
        "proposed_acquisition_cost",
        "purchase_batch_id",
        "store_name",
        "purchase_total_paid",
        "sale_id",
        "expected_payout",
        "profit_before",
        "profit_after",
        "status",
        "manual_review",
        "notes",
        "internal_notes",
    ]
    print(",".join(fieldnames))
    for row in rows:
        values = []
        for field in fieldnames:
            value = row.get(field)
            text = "" if value is None else str(value)
            values.append(csv_escape(text))
        print(",".join(values))


def csv_escape(value: str) -> str:
    if any(character in value for character in [",", '"', "\n"]):
        return '"' + value.replace('"', '""') + '"'
    return value


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Dry-run repair report for gift cards whose acquisition cost exceeds "
            "face value."
        )
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Apply corrections. Requires --ids or --include-csv.",
    )
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview proposed corrections without changing data. This is the default.",
    )
    parser.add_argument(
        "--ids",
        action="append",
        default=[],
        help="Comma-separated card IDs approved for correction.",
    )
    parser.add_argument(
        "--include-csv",
        help="CSV containing card_id or id values approved for correction.",
    )
    args = parser.parse_args()

    approved_ids = parse_ids(args.ids) | parse_csv_ids(args.include_csv)
    if args.apply and not approved_ids:
        parser.error("--apply requires --ids or --include-csv")

    db = SessionLocal()
    try:
        rows = [dict(row._mapping) for row in db.execute(REPORT_SQL)]
        for row in rows:
            row["manual_review"] = "yes" if has_premium_note(row) else ""

        print_report(rows)

        total_overstatement = sum(
            decimal_value(row["old_acquisition_cost"])
            - decimal_value(row["proposed_acquisition_cost"])
            for row in rows
        )
        manual_review_count = sum(1 for row in rows if row["manual_review"])
        print()
        print(f"Candidate cards: {len(rows)}")
        print(f"Manual review flags: {manual_review_count}")
        print(f"Total overstatement: {total_overstatement}")

        if not args.apply:
            print("Dry run only. No data changed.")
            return 0

        eligible_ids = {
            int(row["card_id"])
            for row in rows
            if not row["manual_review"]
        }
        ids_to_update = sorted(approved_ids & eligible_ids)
        skipped_ids = sorted(approved_ids - eligible_ids)

        if not ids_to_update:
            print("No approved, eligible cards to update.")
            if skipped_ids:
                print(f"Skipped IDs: {skipped_ids}")
            return 0

        db.execute(UPDATE_SQL, {"card_ids": ids_to_update})
        db.commit()
        print(f"Updated {len(ids_to_update)} gift card(s): {ids_to_update}")
        if skipped_ids:
            print(f"Skipped IDs not eligible or flagged for review: {skipped_ids}")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
