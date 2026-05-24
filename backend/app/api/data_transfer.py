import hashlib
import json
import os
import shutil
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.buyer import Buyer
from app.models.card_image import CardImage
from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.models.payment_account import PaymentAccount
from app.models.purchase_batch import PurchaseBatch
from app.models.receipt import Receipt
from app.models.sale import Sale
from app.models.sale_fuel_account import SaleFuelAccount
from app.models.sale_gift_card import SaleGiftCard


router = APIRouter(prefix="/data-transfer", tags=["data-transfer"])

EXPORT_VERSION = "1.0"
CARD_IMAGE_DIR = Path("uploads/card-images")
RECEIPT_DIR = Path("uploads/receipts")


def json_default(value: Any):
    if isinstance(value, Decimal):
        return str(value)

    if isinstance(value, datetime):
        return value.isoformat()

    if hasattr(value, "isoformat"):
        return value.isoformat()

    return value


def row_dict(row, exclude: set[str] | None = None) -> dict:
    excluded = exclude or set()
    return {
        column.name: getattr(row, column.name)
        for column in row.__table__.columns
        if column.name not in excluded
    }


def parse_ids(value: str | None) -> list[int]:
    if not value:
        return []

    return [
        int(piece)
        for piece in value.split(",")
        if piece.strip().isdigit()
    ]


def parse_decimal(value: str | int | float | None) -> Decimal | None:
    if value in (None, ""):
        return None

    return Decimal(str(value))


def local_upload_path(path_or_url: str | None) -> Path | None:
    if not path_or_url:
        return None

    parsed_path = (
        urlparse(path_or_url).path
        if path_or_url.startswith(("http://", "https://"))
        else path_or_url
    )

    for candidate in [Path(parsed_path), Path(parsed_path.lstrip("/"))]:
        if candidate.exists() and candidate.is_file():
            return candidate

    return None


def archive_file(
    zip_file: ZipFile,
    path_or_url: str | None,
    prefix: str,
    source_id: int,
) -> str | None:
    source_path = local_upload_path(path_or_url)

    if source_path is None:
        return None

    extension = source_path.suffix or ".jpg"
    archive_name = f"{prefix}/{source_id}{extension}"
    zip_file.write(source_path, archive_name)
    return archive_name


def package_json(payload: dict) -> bytes:
    return json.dumps(payload, default=json_default, indent=2, sort_keys=True).encode()


def collect_transfer_data(
    db: Session,
    purchase_ids: list[int],
    sale_ids: list[int],
) -> dict:
    sale_links = (
        db.query(SaleGiftCard)
        .filter(SaleGiftCard.sale_id.in_(sale_ids or [-1]))
        .all()
    )
    sale_card_ids = {link.gift_card_id for link in sale_links}
    explicit_cards = (
        db.query(GiftCard)
        .filter(GiftCard.purchase_batch_id.in_(purchase_ids or [-1]))
        .all()
    )
    card_ids = {card.id for card in explicit_cards} | sale_card_ids
    cards = (
        db.query(GiftCard)
        .filter(GiftCard.id.in_(card_ids or [-1]))
        .all()
    )
    all_purchase_ids = set(purchase_ids) | {card.purchase_batch_id for card in cards}
    purchases = (
        db.query(PurchaseBatch)
        .filter(PurchaseBatch.id.in_(all_purchase_ids or [-1]))
        .all()
    )
    sales = db.query(Sale).filter(Sale.id.in_(sale_ids or [-1])).all()
    sale_fuel_links = (
        db.query(SaleFuelAccount)
        .filter(SaleFuelAccount.sale_id.in_(sale_ids or [-1]))
        .all()
    )
    fuel_entry_account_ids = {
        entry.fuel_reward_account_id
        for entry in db.query(FuelPointEntry)
        .filter(FuelPointEntry.purchase_batch_id.in_(all_purchase_ids or [-1]))
        .all()
    }
    fuel_account_ids = fuel_entry_account_ids | {
        link.fuel_reward_account_id for link in sale_fuel_links
    }
    buyer_ids = {sale.buyer_id for sale in sales}
    payment_account_ids = {
        sale.payment_account_id for sale in sales if sale.payment_account_id is not None
    }
    buyers = db.query(Buyer).filter(Buyer.id.in_(buyer_ids or [-1])).all()
    payment_accounts = (
        db.query(PaymentAccount)
        .filter(PaymentAccount.id.in_(payment_account_ids or [-1]))
        .all()
    )

    return {
        "purchases": [row_dict(purchase) for purchase in purchases],
        "cards": [row_dict(card) for card in cards],
        "receipts": [
            row_dict(receipt)
            for receipt in db.query(Receipt)
            .filter(Receipt.purchase_batch_id.in_(all_purchase_ids or [-1]))
            .all()
        ],
        "card_images": [
            row_dict(image)
            for image in db.query(CardImage)
            .filter(CardImage.gift_card_id.in_(card_ids or [-1]))
            .all()
        ],
        "fuel_transactions": [
            row_dict(entry)
            for entry in db.query(FuelPointEntry)
            .filter(FuelPointEntry.purchase_batch_id.in_(all_purchase_ids or [-1]))
            .all()
        ],
        "sales": [row_dict(sale) for sale in sales],
        "sale_gift_cards": [row_dict(link) for link in sale_links],
        "sale_fuel_accounts": [
            row_dict(link)
            for link in sale_fuel_links
        ],
        "fuel_accounts": [
            row_dict(account)
            for account in db.query(FuelRewardAccount)
            .filter(FuelRewardAccount.id.in_(fuel_account_ids or [-1]))
            .all()
        ],
        "buyers": [row_dict(buyer) for buyer in buyers],
        "payment_accounts": [row_dict(account) for account in payment_accounts],
    }


@router.get("/export")
def export_transfer(purchases: str | None = None, sales: str | None = None):
    purchase_ids = parse_ids(purchases)
    sale_ids = parse_ids(sales)

    if not purchase_ids and not sale_ids:
        raise HTTPException(status_code=400, detail="Select purchases or sales to export")

    db: Session = SessionLocal()

    try:
        if sale_ids:
            voided_sales = (
                db.query(Sale)
                .filter(Sale.id.in_(sale_ids))
                .filter(Sale.status == "VOIDED")
                .all()
            )
            if voided_sales:
                raise HTTPException(
                    status_code=410,
                    detail={
                        "error": "sale_export_revoked",
                        "message": "Voided sales cannot be exported.",
                        "sale_ids": [sale.id for sale in voided_sales],
                    },
                )

        data = collect_transfer_data(db, purchase_ids, sale_ids)
        manifest = {
            "export_version": EXPORT_VERSION,
            "exported_at": datetime.utcnow().isoformat(),
            "source_environment": os.getenv("MS_TRACKER_ENV", "test"),
            "source_record_ids": {
                "purchases": purchase_ids,
                "sales": sale_ids,
            },
        }
        checksum_payload = package_json(data)
        manifest["sha256"] = hashlib.sha256(checksum_payload).hexdigest()

        buffer = BytesIO()
        with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
            zip_file.writestr("manifest.json", package_json(manifest))
            for filename in [
                "purchases",
                "cards",
                "sales",
                "fuel_transactions",
                "receipts",
                "card_images",
                "sale_gift_cards",
                "sale_fuel_accounts",
                "buyers",
                "payment_accounts",
                "fuel_accounts",
            ]:
                zip_file.writestr(f"{filename}.json", package_json(data[filename]))

            for receipt in data["receipts"]:
                archive_file(zip_file, receipt.get("image_url"), "receipts", receipt["id"])

            for image in data["card_images"]:
                archive_file(
                    zip_file,
                    image.get("original_image_url"),
                    "card_images",
                    image["id"],
                )

        buffer.seek(0)
        filename = (
            f"ms-transfer_purchases-{len(purchase_ids)}_sales-{len(sale_ids)}.zip"
        )
        return StreamingResponse(
            buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    finally:
        db.close()


def load_package(contents: bytes) -> dict:
    with ZipFile(BytesIO(contents)) as zip_file:
        required = [
            "manifest.json",
            "purchases.json",
            "cards.json",
            "sales.json",
            "fuel_transactions.json",
        ]
        for filename in required:
            if filename not in zip_file.namelist():
                raise HTTPException(status_code=400, detail=f"Missing {filename}")

        package = {
            "manifest": json.loads(zip_file.read("manifest.json")),
            "purchases": json.loads(zip_file.read("purchases.json")),
            "cards": json.loads(zip_file.read("cards.json")),
            "sales": json.loads(zip_file.read("sales.json")),
            "fuel_transactions": json.loads(zip_file.read("fuel_transactions.json")),
            "receipts": json.loads(zip_file.read("receipts.json")) if "receipts.json" in zip_file.namelist() else [],
            "card_images": json.loads(zip_file.read("card_images.json")) if "card_images.json" in zip_file.namelist() else [],
            "sale_gift_cards": json.loads(zip_file.read("sale_gift_cards.json")) if "sale_gift_cards.json" in zip_file.namelist() else [],
            "sale_fuel_accounts": json.loads(zip_file.read("sale_fuel_accounts.json")) if "sale_fuel_accounts.json" in zip_file.namelist() else [],
            "buyers": json.loads(zip_file.read("buyers.json")) if "buyers.json" in zip_file.namelist() else [],
            "payment_accounts": json.loads(zip_file.read("payment_accounts.json")) if "payment_accounts.json" in zip_file.namelist() else [],
            "fuel_accounts": json.loads(zip_file.read("fuel_accounts.json")) if "fuel_accounts.json" in zip_file.namelist() else [],
        }
        package["_raw"] = contents
        return package


def preview_package(db: Session, package: dict) -> dict:
    duplicate_cards = []
    duplicate_purchases = []

    for card in package["cards"]:
        if not card.get("card_number_encrypted"):
            continue
        duplicate = (
            db.query(GiftCard)
            .filter(GiftCard.brand == card.get("brand"))
            .filter(GiftCard.card_number_encrypted == card.get("card_number_encrypted"))
        )
        if card.get("pin_encrypted"):
            duplicate = duplicate.filter(GiftCard.pin_encrypted == card.get("pin_encrypted"))
        duplicate = duplicate.first()
        if duplicate:
            duplicate_cards.append(
                {
                    "source_id": card.get("id"),
                    "existing_id": duplicate.id,
                    "brand": card.get("brand"),
                    "card_ending": str(card.get("card_number_encrypted"))[-4:],
                }
            )

    for purchase in package["purchases"]:
        duplicate = find_duplicate_purchase(db, purchase)
        if duplicate:
            duplicate_purchases.append(
                {"source_id": purchase.get("id"), "existing_id": duplicate.id}
            )

    return {
        "manifest": package["manifest"],
        "counts": {
            "purchases": len(package["purchases"]),
            "cards": len(package["cards"]),
            "sales": len(package["sales"]),
            "fuel_transactions": len(package["fuel_transactions"]),
            "receipts": len(package["receipts"]),
            "card_images": len(package["card_images"]),
        },
        "conflicts": {
            "duplicate_cards": duplicate_cards,
            "duplicate_purchases": duplicate_purchases,
        },
    }


@router.post("/import/preview")
async def preview_transfer(file: UploadFile = File(...)):
    contents = await file.read()
    package = load_package(contents)
    db: Session = SessionLocal()

    try:
        return preview_package(db, package)
    finally:
        db.close()


def parse_datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def copy_archive_file(zip_file: ZipFile, archive_name: str, destination_dir: Path) -> str | None:
    if archive_name not in zip_file.namelist():
        return None

    destination_dir.mkdir(parents=True, exist_ok=True)
    extension = Path(archive_name).suffix or ".jpg"
    destination = destination_dir / f"{uuid4()}{extension}"
    with zip_file.open(archive_name) as source, open(destination, "wb") as target:
        shutil.copyfileobj(source, target)
    return str(destination)


def find_duplicate_purchase(db: Session, purchase: dict) -> PurchaseBatch | None:
    return (
        db.query(PurchaseBatch)
        .filter(PurchaseBatch.store_name == purchase.get("store_name"))
        .filter(PurchaseBatch.purchase_date == parse_datetime(purchase.get("purchase_date")))
        .filter(PurchaseBatch.purchase_total_paid == parse_decimal(purchase.get("purchase_total_paid")))
        .first()
    )


@router.post("/import/apply")
async def apply_transfer(file: UploadFile = File(...), allow_duplicates: bool = False):
    contents = await file.read()
    package = load_package(contents)
    db: Session = SessionLocal()

    try:
        preview = preview_package(db, package)
        if preview["conflicts"]["duplicate_cards"] and not allow_duplicates:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "duplicate_cards",
                    "message": "Duplicate cards detected. Preview import before applying.",
                    "conflicts": preview["conflicts"]["duplicate_cards"],
                },
            )

        purchase_map: dict[int, int] = {}
        card_map: dict[int, int] = {}
        sale_map: dict[int, int] = {}
        created_purchase_count = 0
        imported_at = datetime.utcnow()
        source_environment = package["manifest"].get("source_environment")

        for source in package["purchases"]:
            duplicate_purchase = find_duplicate_purchase(db, source)
            if duplicate_purchase:
                purchase_map[source["id"]] = duplicate_purchase.id
                continue

            purchase = PurchaseBatch(
                store_name=source["store_name"],
                purchase_date=parse_datetime(source["purchase_date"]),
                total_amount=source.get("total_amount") or 0,
                purchase_total_paid=source.get("purchase_total_paid"),
                sales_tax=source.get("sales_tax"),
                activation_fees=source.get("activation_fees"),
                discounts=source.get("discounts"),
                fuel_point_estimated_value=source.get("fuel_point_estimated_value"),
                fuel_points_quantity=source.get("fuel_points_quantity"),
                fuel_points_unit=source.get("fuel_points_unit"),
                fuel_points_notes=source.get("fuel_points_notes"),
                financial_notes=source.get("financial_notes"),
                notes=source.get("notes"),
                created_at=parse_datetime(source.get("created_at")) or imported_at,
                updated_at=imported_at,
                imported_from_environment=source_environment,
                imported_source_id=str(source["id"]),
                imported_at=imported_at,
            )
            db.add(purchase)
            db.flush()
            purchase_map[source["id"]] = purchase.id
            created_purchase_count += 1

        for source in package["cards"]:
            if source.get("purchase_batch_id") not in purchase_map:
                continue
            duplicate = None
            if source.get("card_number_encrypted"):
                duplicate = (
                    db.query(GiftCard)
                    .filter(GiftCard.brand == source.get("brand"))
                    .filter(GiftCard.card_number_encrypted == source.get("card_number_encrypted"))
                )
                if source.get("pin_encrypted"):
                    duplicate = duplicate.filter(GiftCard.pin_encrypted == source.get("pin_encrypted"))
                duplicate = duplicate.first()
            if duplicate and not allow_duplicates:
                continue

            card = GiftCard(
                purchase_batch_id=purchase_map[source["purchase_batch_id"]],
                brand=source["brand"],
                face_value=source.get("face_value") or 0,
                acquisition_cost=source.get("acquisition_cost"),
                status=source.get("status") or "NEEDS_VERIFICATION",
                card_number_encrypted=source.get("card_number_encrypted"),
                pin_encrypted=source.get("pin_encrypted"),
                sold_to=source.get("sold_to"),
                sold_date=parse_date(source.get("sold_date")),
                sale_price=source.get("sale_price"),
                sale_notes=source.get("sale_notes"),
                asking_price=source.get("asking_price"),
                expected_payout=source.get("expected_payout"),
                liquidation_rate=source.get("liquidation_rate"),
                reserved_at=parse_datetime(source.get("reserved_at")),
                sold_at=parse_datetime(source.get("sold_at")),
                expected_payment_date=parse_date(source.get("expected_payment_date")),
                settlement_received_at=parse_datetime(source.get("settlement_received_at")),
                payout_received=source.get("payout_received"),
                internal_notes=source.get("internal_notes"),
                verified_balance=source.get("verified_balance"),
                verified_at=parse_datetime(source.get("verified_at")),
                verification_notes=source.get("verification_notes"),
                verification_source=source.get("verification_source"),
                verification_status=source.get("verification_status") or "PENDING",
                detected_card_number=source.get("detected_card_number"),
                detected_pin=source.get("detected_pin"),
                notes=source.get("notes"),
                void_reason=source.get("void_reason"),
                created_at=parse_datetime(source.get("created_at")) or imported_at,
                updated_at=imported_at,
                imported_from_environment=source_environment,
                imported_source_id=str(source["id"]),
                imported_at=imported_at,
            )
            db.add(card)
            db.flush()
            card_map[source["id"]] = card.id

        payment_by_source: dict[int, PaymentAccount] = {}
        for source in package["payment_accounts"]:
            account = db.query(PaymentAccount).filter(PaymentAccount.name == source["name"]).first()
            if not account:
                account = PaymentAccount(
                    name=source["name"],
                    account_type=source.get("account_type") or "other",
                    institution=source.get("institution"),
                    last_four=source.get("last_four"),
                    account_identifier=source.get("account_identifier"),
                    payment_identifier=source.get("payment_identifier"),
                    is_business_account=source.get("is_business_account", False),
                    bank_account_type=source.get("bank_account_type"),
                    notes=source.get("notes"),
                    active=source.get("active", True),
                    created_at=parse_datetime(source.get("created_at")) or imported_at,
                    updated_at=imported_at,
                )
                db.add(account)
                db.flush()
            payment_by_source[source["id"]] = account

        buyer_by_source: dict[int, Buyer] = {}
        for source in package["buyers"]:
            buyer = db.query(Buyer).filter(Buyer.name == source["name"]).first()
            if not buyer:
                default_payment_account = payment_by_source.get(source.get("default_payment_account_id"))
                buyer = Buyer(
                    name=source["name"],
                    buyer_type=source.get("buyer_type"),
                    contact_email=source.get("contact_email"),
                    active=source.get("active", True),
                    default_payout_days=source.get("default_payout_days"),
                    default_payout_rate=source.get("default_payout_rate"),
                    requires_card_images=source.get("requires_card_images", False),
                    requires_receipt_images=source.get("requires_receipt_images", False),
                    preferred_export_type=source.get("preferred_export_type") or "TXT",
                    card_export_format=source.get("card_export_format"),
                    fuel_export_format=source.get("fuel_export_format"),
                    default_payment_account_id=(
                        default_payment_account.id if default_payment_account else None
                    ),
                    payment_timing_notes=source.get("payment_timing_notes"),
                    payment_reference_format=source.get("payment_reference_format"),
                    payment_instructions=source.get("payment_instructions"),
                    notes=source.get("notes"),
                    created_at=parse_datetime(source.get("created_at")) or imported_at,
                )
                db.add(buyer)
                db.flush()
            buyer_by_source[source["id"]] = buyer

        fuel_account_by_source: dict[int, FuelRewardAccount] = {}
        for source in package["fuel_accounts"]:
            account = (
                db.query(FuelRewardAccount)
                .filter(FuelRewardAccount.retailer == source.get("retailer"))
                .filter(FuelRewardAccount.email == source.get("email"))
                .filter(FuelRewardAccount.alt_id == source.get("alt_id"))
                .first()
            )
            if not account:
                buyer = buyer_by_source.get(source.get("buyer_id"))
                account = FuelRewardAccount(
                    retailer=source["retailer"],
                    email=source.get("email"),
                    alt_id=source.get("alt_id"),
                    status=source.get("status") or "ACTIVE",
                    target_points=source.get("target_points"),
                    barcode_image_url=source.get("barcode_image_url"),
                    barcode_value=source.get("barcode_value"),
                    login_password=source.get("login_password"),
                    buyer_id=buyer.id if buyer else None,
                    sold_to=source.get("sold_to"),
                    sold_date=parse_date(source.get("sold_date")),
                    expected_payment_date=parse_date(source.get("expected_payment_date")),
                    sale_price=source.get("sale_price"),
                    sale_notes=source.get("sale_notes"),
                    notes=source.get("notes"),
                    created_at=parse_datetime(source.get("created_at")) or imported_at,
                    updated_at=imported_at,
                )
                db.add(account)
                db.flush()
            fuel_account_by_source[source["id"]] = account

        for source in package["fuel_transactions"]:
            if source.get("purchase_batch_id") not in purchase_map:
                continue
            account = fuel_account_by_source.get(source["fuel_reward_account_id"])
            if not account:
                continue
            entry = FuelPointEntry(
                fuel_reward_account_id=account.id,
                purchase_batch_id=purchase_map[source["purchase_batch_id"]],
                earned_date=parse_date(source["earned_date"]),
                expires_on=parse_date(source["expires_on"]),
                multiplier=source.get("multiplier"),
                qualifying_spend=source.get("qualifying_spend"),
                points_earned=source.get("points_earned") or 0,
                entry_type=source.get("entry_type") or "PURCHASE",
                notes=source.get("notes"),
                created_at=parse_datetime(source.get("created_at")) or imported_at,
            )
            db.add(entry)

        for source in package["sales"]:
            buyer = buyer_by_source.get(source["buyer_id"])
            if not buyer:
                continue
            sale = Sale(
                buyer_id=buyer.id,
                sold_at=parse_datetime(source.get("sold_at")) or imported_at,
                expected_payout=source.get("expected_payout") or 0,
                card_payout_rate=source.get("card_payout_rate"),
                fuel_rate_per_1000=source.get("fuel_rate_per_1000"),
                payout_received=source.get("payout_received"),
                payment_account_id=(
                    payment_by_source.get(source.get("payment_account_id")).id
                    if payment_by_source.get(source.get("payment_account_id"))
                    else None
                ),
                status=source.get("status") or "SOLD_PENDING_PAYMENT",
                notes=source.get("notes"),
                created_at=parse_datetime(source.get("created_at")) or imported_at,
                updated_at=imported_at,
                imported_from_environment=source_environment,
                imported_source_id=str(source["id"]),
                imported_at=imported_at,
            )
            db.add(sale)
            db.flush()
            sale_map[source["id"]] = sale.id

        for source in package["sale_gift_cards"]:
            if source.get("sale_id") in sale_map and source.get("gift_card_id") in card_map:
                db.add(
                    SaleGiftCard(
                        sale_id=sale_map[source["sale_id"]],
                        gift_card_id=card_map[source["gift_card_id"]],
                        expected_payout=source.get("expected_payout"),
                        payout_received=source.get("payout_received"),
                    )
                )

        for source in package["sale_fuel_accounts"]:
            account = fuel_account_by_source.get(source.get("fuel_reward_account_id"))
            if source.get("sale_id") in sale_map and account:
                db.add(
                    SaleFuelAccount(
                        sale_id=sale_map[source["sale_id"]],
                        fuel_reward_account_id=account.id,
                        points_sold=source.get("points_sold") or 0,
                        expected_value=source.get("expected_value"),
                        is_full_account_sale=source.get("is_full_account_sale", True),
                        fuel_overage_override=source.get("fuel_overage_override", False),
                        overage_points=source.get("overage_points"),
                        payout_received=source.get("payout_received"),
                    )
                )

        raw_zip = ZipFile(BytesIO(package["_raw"]))
        for source in package["receipts"]:
            if source.get("purchase_batch_id") not in purchase_map:
                continue
            archive_candidates = [
                name for name in raw_zip.namelist()
                if name.startswith(f"receipts/{source['id']}.")
            ]
            image_url = (
                copy_archive_file(raw_zip, archive_candidates[0], RECEIPT_DIR)
                if archive_candidates
                else source.get("image_url")
            )
            if image_url:
                db.add(
                    Receipt(
                        purchase_batch_id=purchase_map[source["purchase_batch_id"]],
                        image_url=image_url,
                        original_filename=source.get("original_filename"),
                        notes=source.get("notes"),
                    )
                )

        for source in package["card_images"]:
            if source.get("gift_card_id") not in card_map:
                continue
            archive_candidates = [
                name for name in raw_zip.namelist()
                if name.startswith(f"card_images/{source['id']}.")
            ]
            image_url = (
                copy_archive_file(raw_zip, archive_candidates[0], CARD_IMAGE_DIR)
                if archive_candidates
                else source.get("original_image_url")
            )
            if image_url:
                db.add(
                    CardImage(
                        gift_card_id=card_map[source["gift_card_id"]],
                        image_type=source.get("image_type") or "primary",
                        original_image_url=image_url,
                        processed_image_url=source.get("processed_image_url"),
                    )
                )

        db.commit()
        return {
            "imported_at": imported_at,
            "source_environment": source_environment,
            "created": {
                "purchases": created_purchase_count,
                "cards": len(card_map),
                "sales": len(sale_map),
            },
            "skipped": {
                "duplicate_cards": len(preview["conflicts"]["duplicate_cards"]),
            },
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
