import hashlib
import json
import os
from datetime import date, datetime
from app.utils.time import utc_now
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
from app.models.credit_card import CreditCard
from app.models.credit_card_reward_rule import CreditCardRewardRule
from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.models.payment_account import PaymentAccount
from app.models.player import Player
from app.models.purchase_batch import PurchaseBatch
from app.models.purchase_payment import PurchasePayment
from app.models.receipt import Receipt
from app.models.reward_program import RewardProgram
from app.models.sale import Sale
from app.models.sale_event import SaleEvent
from app.models.sale_fuel_account import SaleFuelAccount
from app.models.sale_gift_card import SaleGiftCard
from app.models.spending_category import SpendingCategory
from app.services.field_encryption import (
    CredentialDecryptionError,
    UNDECRYPTABLE_CREDENTIAL_MESSAGE,
    decrypt_field,
    encrypt_field,
    try_decrypt_field,
)
from app.services.upload_storage import (
    physical_upload_path,
    upload_dir,
)
from app.services.storage import normalize_object_key, object_key_for, storage


router = APIRouter(prefix="/data-transfer", tags=["data-transfer"])

EXPORT_VERSION = "1.0"
CARD_IMAGE_DIR = upload_dir("card-images")
RECEIPT_DIR = upload_dir("receipts")
SENSITIVE_TRANSFER_DISABLED_MESSAGE = (
    "Sensitive transfer export/import is disabled for this environment."
)
SENSITIVE_TRANSFER_WARNING = (
    "This transfer contains sensitive card numbers, PINs, and account credentials. "
    "Store securely and delete after import."
)
IMAGE_PACKAGE_CORE_REQUIRED_MESSAGE = (
    "Linked image package cannot be imported until the matching core transfer "
    "package has been imported."
)
LARGE_TRANSFER_WARNING_BYTES = 50 * 1024 * 1024
CARD_SENSITIVE_FIELDS = {
    "card_number_encrypted",
    "pin_encrypted",
    "confirmed_card_number",
    "confirmed_pin",
    "confirmed_redemption_code",
    "detected_card_number",
    "detected_pin",
}
FUEL_ACCOUNT_SENSITIVE_FIELDS = {"login_password"}


def env_flag_enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def sensitive_export_enabled() -> bool:
    return env_flag_enabled("ALLOW_SENSITIVE_TRANSFER_EXPORT")


def sensitive_import_enabled() -> bool:
    return env_flag_enabled("ALLOW_SENSITIVE_TRANSFER_IMPORT")


def require_sensitive_transfer_enabled(kind: str) -> None:
    enabled = (
        sensitive_export_enabled()
        if kind == "export"
        else sensitive_import_enabled()
    )
    if not enabled:
        raise HTTPException(
            status_code=403,
            detail=SENSITIVE_TRANSFER_DISABLED_MESSAGE,
        )


def require_sensitive_acknowledgement(acknowledge_sensitive: bool) -> None:
    if not acknowledge_sensitive:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "sensitive_transfer_acknowledgement_required",
                "message": SENSITIVE_TRANSFER_WARNING,
            },
        )


@router.get("/capabilities")
def data_transfer_capabilities():
    return {
        "export_enabled": True,
        "import_enabled": True,
        "sensitive_export_enabled": sensitive_export_enabled(),
        "sensitive_import_enabled": sensitive_import_enabled(),
    }


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


def decrypt_sensitive_fields(row: dict, fields: set[str]) -> dict:
    decrypted_row = dict(row)
    for field in fields:
        if field not in decrypted_row:
            continue
        try:
            decrypted_row[field] = decrypt_field(decrypted_row[field])
        except CredentialDecryptionError as exc:
            raise HTTPException(
                status_code=400,
                detail=UNDECRYPTABLE_CREDENTIAL_MESSAGE,
            ) from exc
    return decrypted_row


def prepare_sensitive_transfer_data(data: dict) -> dict:
    sensitive_data = dict(data)
    sensitive_data["cards"] = [
        decrypt_sensitive_fields(card, CARD_SENSITIVE_FIELDS)
        for card in data["cards"]
    ]
    sensitive_data["fuel_accounts"] = [
        decrypt_sensitive_fields(account, FUEL_ACCOUNT_SENSITIVE_FIELDS)
        for account in data["fuel_accounts"]
    ]
    return sensitive_data


def image_mode_value(include_images: bool, image_mode: str | None) -> str:
    if image_mode:
        normalized = image_mode.strip().lower()
        if normalized in {"exclude", "inline", "linked"}:
            return normalized
        raise HTTPException(
            status_code=400,
            detail="Image mode must be exclude, inline, or linked.",
        )
    return "inline" if include_images else "exclude"


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


def credential_ending(value: str | None, length: int = 4) -> str | None:
    if not value:
        return None
    normalized = "".join(character for character in str(value) if character.isalnum())
    return normalized[-length:] if normalized else None


def normalized_credential(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = "".join(character for character in str(value) if character.isalnum())
    return normalized or None


def source_card_values(card: dict) -> set[str]:
    values = {
        normalized_credential(card.get("confirmed_redemption_code")),
        normalized_credential(card.get("confirmed_card_number")),
        normalized_credential(card.get("card_number_encrypted")),
    }
    return {value for value in values if value}


def source_pin_values(card: dict) -> set[str]:
    values = {
        normalized_credential(card.get("confirmed_pin")),
        normalized_credential(card.get("pin_encrypted")),
    }
    return {value for value in values if value}


def target_card_values(card: GiftCard) -> tuple[set[str], set[str], bool]:
    unavailable = False
    card_values: set[str] = set()
    pin_values: set[str] = set()
    for field in (
        card.confirmed_redemption_code,
        card.confirmed_card_number,
        card.card_number_encrypted,
    ):
        value, field_unavailable = try_decrypt_field(field)
        unavailable = unavailable or field_unavailable
        normalized = normalized_credential(value)
        if normalized:
            card_values.add(normalized)
    for field in (card.confirmed_pin, card.pin_encrypted):
        value, field_unavailable = try_decrypt_field(field)
        unavailable = unavailable or field_unavailable
        normalized = normalized_credential(value)
        if normalized:
            pin_values.add(normalized)
    return card_values, pin_values, unavailable


def local_upload_path(path_or_url: str | None) -> Path | None:
    if not path_or_url:
        return None

    parsed_path = (
        urlparse(path_or_url).path
        if path_or_url.startswith(("http://", "https://"))
        else path_or_url
    )

    upload_candidate = physical_upload_path(path_or_url)
    candidates = [
        upload_candidate,
        Path(parsed_path),
        Path(parsed_path.lstrip("/")),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        if candidate.exists() and candidate.is_file():
            return candidate

    return None


def archive_file(
    zip_file: ZipFile,
    path_or_url: str | None,
    prefix: str,
    source_id: int,
) -> str | None:
    if not path_or_url:
        return None

    object_key = normalize_object_key(path_or_url)
    extension = Path(object_key).suffix or ".jpg"
    archive_name = f"{prefix}/{source_id}{extension}"
    try:
        zip_file.writestr(archive_name, storage.read(object_key))
        return archive_name
    except Exception:
        source_path = local_upload_path(path_or_url)
        if source_path is None:
            return None
        zip_file.write(source_path, archive_name)
        return archive_name


def archive_file_size(path_or_url: str | None) -> int:
    if not path_or_url:
        return 0

    object_key = normalize_object_key(path_or_url)
    try:
        return len(storage.read(object_key))
    except Exception:
        source_path = local_upload_path(path_or_url)
        if source_path is None:
            return 0
        return source_path.stat().st_size


def package_json(payload: dict) -> bytes:
    return json.dumps(payload, default=json_default, indent=2, sort_keys=True).encode()


def write_image_payloads(zip_file: ZipFile, data: dict) -> None:
    for receipt in data["receipts"]:
        archive_file(
            zip_file,
            receipt.get("image_url"),
            "receipts",
            receipt["id"],
        )

    for image in data["card_images"]:
        archive_file(
            zip_file,
            image.get("original_image_url"),
            "card_images",
            image["id"],
        )


def query_by_ids(db: Session, model, ids: set[int]):
    if not ids:
        return []
    return db.query(model).filter(model.id.in_(ids)).all()


def collect_transfer_data(
    db: Session,
    purchase_ids: list[int],
    sale_ids: list[int],
    include_images: bool = False,
) -> dict:
    purchase_id_set = set(purchase_ids)
    sale_id_set = set(sale_ids)
    card_id_set: set[int] = set()

    for _ in range(4):
        changed = False

        if purchase_id_set:
            for (card_id,) in (
                db.query(GiftCard.id)
                .filter(GiftCard.purchase_batch_id.in_(purchase_id_set))
                .all()
            ):
                if card_id not in card_id_set:
                    card_id_set.add(card_id)
                    changed = True

        if sale_id_set:
            for link in (
                db.query(SaleGiftCard)
                .filter(SaleGiftCard.sale_id.in_(sale_id_set))
                .all()
            ):
                if link.gift_card_id not in card_id_set:
                    card_id_set.add(link.gift_card_id)
                    changed = True

        if card_id_set:
            for card in query_by_ids(db, GiftCard, card_id_set):
                if card.purchase_batch_id not in purchase_id_set:
                    purchase_id_set.add(card.purchase_batch_id)
                    changed = True

            for (linked_sale_id,) in (
                db.query(SaleGiftCard.sale_id)
                .filter(SaleGiftCard.gift_card_id.in_(card_id_set))
                .all()
            ):
                if linked_sale_id not in sale_id_set:
                    sale_id_set.add(linked_sale_id)
                    changed = True

        if not changed:
            break

    sale_links = (
        db.query(SaleGiftCard)
        .filter(SaleGiftCard.sale_id.in_(sale_id_set or {-1}))
        .all()
    )
    for link in sale_links:
        card_id_set.add(link.gift_card_id)

    cards = query_by_ids(db, GiftCard, card_id_set)
    for card in cards:
        purchase_id_set.add(card.purchase_batch_id)

    purchases = query_by_ids(db, PurchaseBatch, purchase_id_set)
    sales = query_by_ids(db, Sale, sale_id_set)
    sale_fuel_links = (
        db.query(SaleFuelAccount)
        .filter(SaleFuelAccount.sale_id.in_(sale_id_set or {-1}))
        .all()
    )
    fuel_transactions = (
        db.query(FuelPointEntry)
        .filter(FuelPointEntry.purchase_batch_id.in_(purchase_id_set or {-1}))
        .all()
    )
    purchase_payments = (
        db.query(PurchasePayment)
        .filter(PurchasePayment.purchase_batch_id.in_(purchase_id_set or {-1}))
        .all()
    )
    sale_events = (
        db.query(SaleEvent)
        .filter(SaleEvent.sale_id.in_(sale_id_set or {-1}))
        .all()
    )

    fuel_account_ids = {
        entry.fuel_reward_account_id for entry in fuel_transactions
    } | {link.fuel_reward_account_id for link in sale_fuel_links}
    buyer_ids = {sale.buyer_id for sale in sales if sale.buyer_id is not None} | {
        card.buyer_id for card in cards if card.buyer_id is not None
    }
    payment_account_ids = {
        sale.payment_account_id for sale in sales if sale.payment_account_id is not None
    } | {
        card.settlement_payment_account_id
        for card in cards
        if card.settlement_payment_account_id is not None
    } | {
        link.payment_account_id
        for link in sale_links
        if link.payment_account_id is not None
    } | {
        link.payment_account_id
        for link in sale_fuel_links
        if link.payment_account_id is not None
    }
    credit_card_ids = {
        purchase.credit_card_id
        for purchase in purchases
        if purchase.credit_card_id is not None
    } | {
        payment.credit_card_id
        for payment in purchase_payments
        if payment.credit_card_id is not None
    }
    player_ids = {
        purchase.player_id for purchase in purchases if purchase.player_id is not None
    }
    reward_program_ids = {
        payment.reward_program_id
        for payment in purchase_payments
        if payment.reward_program_id is not None
    }
    spending_category_ids = {
        payment.spending_category_id
        for payment in purchase_payments
        if payment.spending_category_id is not None
    }
    reward_rule_ids = {
        payment.matched_rule_id
        for payment in purchase_payments
        if payment.matched_rule_id is not None
    }
    credit_cards = query_by_ids(db, CreditCard, credit_card_ids)
    players = query_by_ids(db, Player, player_ids)
    reward_programs = query_by_ids(db, RewardProgram, reward_program_ids)
    spending_categories = query_by_ids(db, SpendingCategory, spending_category_ids)
    reward_rules = query_by_ids(db, CreditCardRewardRule, reward_rule_ids)
    fuel_accounts = query_by_ids(db, FuelRewardAccount, fuel_account_ids)
    buyer_ids.update(
        account.buyer_id for account in fuel_accounts if account.buyer_id is not None
    )
    buyers = query_by_ids(db, Buyer, buyer_ids)
    payment_account_ids.update(
        buyer.default_payment_account_id
        for buyer in buyers
        if buyer.default_payment_account_id is not None
    )
    payment_accounts = query_by_ids(db, PaymentAccount, payment_account_ids)
    receipts = (
        db.query(Receipt)
        .filter(Receipt.purchase_batch_id.in_(purchase_id_set or {-1}))
        .all()
        if include_images
        else []
    )
    card_images = (
        db.query(CardImage)
        .filter(CardImage.gift_card_id.in_(card_id_set or {-1}))
        .all()
        if include_images
        else []
    )
    binary_payload_bytes = 0
    if include_images:
        binary_payload_bytes = sum(
            archive_file_size(receipt.image_url) for receipt in receipts
        ) + sum(
            archive_file_size(image.original_image_url) for image in card_images
        )

    return {
        "purchases": [row_dict(purchase) for purchase in purchases],
        "cards": [row_dict(card) for card in cards],
        "purchase_payments": [row_dict(payment) for payment in purchase_payments],
        "receipts": [row_dict(receipt) for receipt in receipts],
        "card_images": [row_dict(image) for image in card_images],
        "fuel_transactions": [row_dict(entry) for entry in fuel_transactions],
        "sales": [row_dict(sale) for sale in sales],
        "sale_gift_cards": [row_dict(link) for link in sale_links],
        "sale_fuel_accounts": [row_dict(link) for link in sale_fuel_links],
        "sale_events": [row_dict(event) for event in sale_events],
        "fuel_accounts": [row_dict(account) for account in fuel_accounts],
        "buyers": [row_dict(buyer) for buyer in buyers],
        "payment_accounts": [row_dict(account) for account in payment_accounts],
        "credit_cards": [row_dict(card) for card in credit_cards],
        "players": [row_dict(player) for player in players],
        "reward_programs": [row_dict(program) for program in reward_programs],
        "spending_categories": [row_dict(category) for category in spending_categories],
        "credit_card_reward_rules": [row_dict(rule) for rule in reward_rules],
        "_metadata": {
            "include_images": include_images,
            "binary_payload_bytes": binary_payload_bytes,
        },
    }


@router.get("/export")
def export_transfer(
    purchases: str | None = None,
    sales: str | None = None,
    include_images: bool = False,
    image_mode: str | None = None,
    sensitive: bool = False,
    acknowledge_sensitive: bool = False,
):
    purchase_ids = parse_ids(purchases)
    sale_ids = parse_ids(sales)
    resolved_image_mode = image_mode_value(include_images, image_mode)
    inline_images = resolved_image_mode == "inline"
    linked_images = resolved_image_mode == "linked"

    if not purchase_ids and not sale_ids:
        raise HTTPException(status_code=400, detail="Select purchases or sales to export")

    if sensitive:
        require_sensitive_transfer_enabled("export")
        require_sensitive_acknowledgement(acknowledge_sensitive)

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

        data = collect_transfer_data(
            db,
            purchase_ids,
            sale_ids,
            include_images=inline_images or linked_images,
        )
        manifest = {
            "export_version": EXPORT_VERSION,
            "exported_at": utc_now().isoformat(),
            "source_environment": os.getenv("MS_TRACKER_ENV", "test"),
            "package_type": "linked_images" if linked_images else "core",
            "sensitive_transfer": sensitive,
            "warning": SENSITIVE_TRANSFER_WARNING if sensitive else None,
            "source_record_ids": {
                "purchases": purchase_ids,
                "sales": sale_ids,
            },
            "image_mode": resolved_image_mode,
            "include_images": inline_images,
            "binary_payload_bytes": data["_metadata"]["binary_payload_bytes"],
            "image_counts": {
                "receipts": len(data["receipts"]),
                "card_images": len(data["card_images"]),
            },
        }
        if linked_images:
            image_data = {
                "receipts": data["receipts"],
                "card_images": data["card_images"],
            }
            manifest["sha256"] = hashlib.sha256(
                package_json(image_data)
            ).hexdigest()

            buffer = BytesIO()
            with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
                zip_file.writestr("manifest.json", package_json(manifest))
                zip_file.writestr("receipts.json", package_json(data["receipts"]))
                zip_file.writestr("card_images.json", package_json(data["card_images"]))
                write_image_payloads(zip_file, data)

            buffer.seek(0)
            filename = (
                f"ms-transfer-images_purchases-{len(purchase_ids)}_"
                f"sales-{len(sale_ids)}.zip"
            )
            return StreamingResponse(
                buffer,
                media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        if not inline_images:
            data["receipts"] = []
            data["card_images"] = []

        if sensitive:
            data = prepare_sensitive_transfer_data(data)
        checksum_payload = package_json(
            {key: value for key, value in data.items() if not key.startswith("_")}
        )
        manifest["sha256"] = hashlib.sha256(checksum_payload).hexdigest()

        buffer = BytesIO()
        with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
            zip_file.writestr("manifest.json", package_json(manifest))
            for filename in [
                "purchases",
                "cards",
                "purchase_payments",
                "sales",
                "fuel_transactions",
                "receipts",
                "card_images",
                "sale_gift_cards",
                "sale_fuel_accounts",
                "sale_events",
                "buyers",
                "payment_accounts",
                "fuel_accounts",
                "credit_cards",
                "players",
                "reward_programs",
                "spending_categories",
                "credit_card_reward_rules",
            ]:
                zip_file.writestr(f"{filename}.json", package_json(data[filename]))

            if inline_images:
                write_image_payloads(zip_file, data)

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
        if "manifest.json" not in zip_file.namelist():
            raise HTTPException(status_code=400, detail="Missing manifest.json")
        manifest = json.loads(zip_file.read("manifest.json"))
        is_image_package = manifest.get("package_type") == "linked_images"
        required = ["manifest.json", "receipts.json", "card_images.json"] if is_image_package else [
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
            "manifest": manifest,
            "purchases": json.loads(zip_file.read("purchases.json")) if "purchases.json" in zip_file.namelist() else [],
            "cards": json.loads(zip_file.read("cards.json")) if "cards.json" in zip_file.namelist() else [],
            "purchase_payments": json.loads(zip_file.read("purchase_payments.json")) if "purchase_payments.json" in zip_file.namelist() else [],
            "sales": json.loads(zip_file.read("sales.json")) if "sales.json" in zip_file.namelist() else [],
            "fuel_transactions": json.loads(zip_file.read("fuel_transactions.json")) if "fuel_transactions.json" in zip_file.namelist() else [],
            "receipts": json.loads(zip_file.read("receipts.json")) if "receipts.json" in zip_file.namelist() else [],
            "card_images": json.loads(zip_file.read("card_images.json")) if "card_images.json" in zip_file.namelist() else [],
            "sale_gift_cards": json.loads(zip_file.read("sale_gift_cards.json")) if "sale_gift_cards.json" in zip_file.namelist() else [],
            "sale_fuel_accounts": json.loads(zip_file.read("sale_fuel_accounts.json")) if "sale_fuel_accounts.json" in zip_file.namelist() else [],
            "sale_events": json.loads(zip_file.read("sale_events.json")) if "sale_events.json" in zip_file.namelist() else [],
            "buyers": json.loads(zip_file.read("buyers.json")) if "buyers.json" in zip_file.namelist() else [],
            "payment_accounts": json.loads(zip_file.read("payment_accounts.json")) if "payment_accounts.json" in zip_file.namelist() else [],
            "fuel_accounts": json.loads(zip_file.read("fuel_accounts.json")) if "fuel_accounts.json" in zip_file.namelist() else [],
            "credit_cards": json.loads(zip_file.read("credit_cards.json")) if "credit_cards.json" in zip_file.namelist() else [],
            "players": json.loads(zip_file.read("players.json")) if "players.json" in zip_file.namelist() else [],
            "reward_programs": json.loads(zip_file.read("reward_programs.json")) if "reward_programs.json" in zip_file.namelist() else [],
            "spending_categories": json.loads(zip_file.read("spending_categories.json")) if "spending_categories.json" in zip_file.namelist() else [],
            "credit_card_reward_rules": json.loads(zip_file.read("credit_card_reward_rules.json")) if "credit_card_reward_rules.json" in zip_file.namelist() else [],
        }
        package["_raw"] = contents
        return package


def preview_package(db: Session, package: dict) -> dict:
    if package["manifest"].get("sensitive_transfer"):
        require_sensitive_transfer_enabled("import")

    if package["manifest"].get("package_type") == "linked_images":
        return preview_image_package(db, package)

    duplicate_cards = []
    duplicate_purchases = []
    duplicate_check_warnings = []
    source_environment = package["manifest"].get("source_environment")
    duplicate_card_source_ids = set()
    duplicate_purchase_source_ids = set()

    for card in package["cards"]:
        duplicate, payload, limited = find_duplicate_card_for_import(db, card, package)
        if payload:
            duplicate_card_source_ids.add(card.get("id"))
            if payload.get("match_type") != "imported_source_id":
                duplicate_cards.append(payload)
        elif limited:
            duplicate_check_warnings.append(
                {
                    "source_id": card.get("id"),
                    "brand": card.get("brand"),
                    "message": (
                        "Duplicate check was limited because an existing target "
                        "credential could not be decrypted."
                    ),
                }
            )

    for purchase in package["purchases"]:
        duplicate = find_duplicate_purchase(db, purchase, source_environment)
        if duplicate:
            duplicate_purchase_source_ids.add(purchase.get("id"))
            duplicate_purchases.append(
                {"source_id": purchase.get("id"), "existing_id": duplicate.id}
            )

    reusable_sales = {
        sale.get("id")
        for sale in package["sales"]
        if find_imported_sale(db, sale, source_environment)
    }
    missing_dependencies = missing_dependency_messages(package)
    package_size_bytes = len(package.get("_raw", b""))
    warnings = {}
    if package_size_bytes >= LARGE_TRANSFER_WARNING_BYTES:
        warnings["large_package"] = {
            "message": "This package is large and may hit upload limits.",
            "package_size_bytes": package_size_bytes,
        }

    return {
        "manifest": package["manifest"],
        "counts": {
            "purchases": len(package["purchases"]),
            "cards": len(package["cards"]),
            "sales": len(package["sales"]),
            "purchase_payments": len(package["purchase_payments"]),
            "fuel_transactions": len(package["fuel_transactions"]),
            "receipts": len(package["receipts"]),
            "card_images": len(package["card_images"]),
            "sale_events": len(package["sale_events"]),
        },
        "plan": {
            "create": {
                "purchases": len(package["purchases"]) - len(duplicate_purchase_source_ids),
                "cards": len(package["cards"]) - len(duplicate_card_source_ids),
                "sales": len(package["sales"]) - len(reusable_sales),
            },
            "reuse": {
                "purchases": len(duplicate_purchase_source_ids),
                "cards": len(duplicate_card_source_ids),
                "sales": len(reusable_sales),
            },
            "missing_dependencies": missing_dependencies,
            "binary_payload_bytes": package["manifest"].get("binary_payload_bytes", 0),
            "package_size_bytes": package_size_bytes,
        },
        "conflicts": {
            "duplicate_cards": duplicate_cards,
            "duplicate_purchases": duplicate_purchases,
            "missing_dependencies": missing_dependencies,
        },
        "warnings": {
            "duplicate_check_limited": duplicate_check_warnings,
            **warnings,
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

    extension = Path(archive_name).suffix or ".jpg"
    filename = f"{uuid4()}{extension}"
    with zip_file.open(archive_name) as source:
        stored = storage.save(
            object_key=object_key_for(destination_dir.name, filename),
            data=source.read(),
            original_filename=Path(archive_name).name,
        )
    return storage.generate_view_url(stored.object_key)


def find_imported_purchase(
    db: Session,
    purchase: dict,
    source_environment: str | None,
) -> PurchaseBatch | None:
    if not source_environment or purchase.get("id") is None:
        return None
    return (
        db.query(PurchaseBatch)
        .filter(PurchaseBatch.imported_from_environment == source_environment)
        .filter(PurchaseBatch.imported_source_id == str(purchase.get("id")))
        .first()
    )


def find_duplicate_purchase(
    db: Session,
    purchase: dict,
    source_environment: str | None = None,
) -> PurchaseBatch | None:
    imported = find_imported_purchase(db, purchase, source_environment)
    if imported:
        return imported
    return (
        db.query(PurchaseBatch)
        .filter(PurchaseBatch.store_name == purchase.get("store_name"))
        .filter(PurchaseBatch.purchase_date == parse_datetime(purchase.get("purchase_date")))
        .filter(PurchaseBatch.purchase_total_paid == parse_decimal(purchase.get("purchase_total_paid")))
        .first()
    )


def find_imported_sale(
    db: Session,
    sale: dict,
    source_environment: str | None,
) -> Sale | None:
    if not source_environment or sale.get("id") is None:
        return None
    return (
        db.query(Sale)
        .filter(Sale.imported_from_environment == source_environment)
        .filter(Sale.imported_source_id == str(sale.get("id")))
        .first()
    )


def preview_image_package(db: Session, package: dict) -> dict:
    source_environment = package["manifest"].get("source_environment")
    missing_core = image_package_missing_core_records(db, package, source_environment)
    duplicate_receipts = image_package_duplicate_receipts(
        db,
        package,
        source_environment,
    )
    duplicate_card_images = image_package_duplicate_card_images(
        db,
        package,
        source_environment,
    )
    package_size_bytes = len(package.get("_raw", b""))
    warnings = {}
    if package_size_bytes >= LARGE_TRANSFER_WARNING_BYTES:
        warnings["large_package"] = {
            "message": "This package is large and may hit upload limits.",
            "package_size_bytes": package_size_bytes,
        }

    return {
        "manifest": package["manifest"],
        "counts": {
            "purchases": 0,
            "cards": 0,
            "sales": 0,
            "receipts": len(package["receipts"]),
            "card_images": len(package["card_images"]),
        },
        "plan": {
            "create": {
                "purchases": 0,
                "cards": 0,
                "sales": 0,
                "receipts": len(package["receipts"]) - len(duplicate_receipts),
                "card_images": len(package["card_images"]) - len(duplicate_card_images),
            },
            "reuse": {
                "purchases": 0,
                "cards": 0,
                "sales": 0,
                "receipts": len(duplicate_receipts),
                "card_images": len(duplicate_card_images),
            },
            "missing_dependencies": missing_core,
            "binary_payload_bytes": package["manifest"].get("binary_payload_bytes", 0),
            "package_size_bytes": package_size_bytes,
        },
        "conflicts": {
            "duplicate_cards": [],
            "duplicate_purchases": [],
            "missing_dependencies": missing_core,
        },
        "warnings": {
            "duplicate_check_limited": [],
            **warnings,
        },
    }


def image_package_missing_core_records(
    db: Session,
    package: dict,
    source_environment: str | None,
) -> list[dict]:
    missing = []
    for receipt in package["receipts"]:
        if not find_imported_purchase(
            db,
            {"id": receipt.get("purchase_batch_id")},
            source_environment,
        ):
            missing.append(
                {
                    "entity": "receipt",
                    "source_id": receipt.get("id"),
                    "missing": "imported_purchase_batch",
                    "missing_source_id": receipt.get("purchase_batch_id"),
                    "message": IMAGE_PACKAGE_CORE_REQUIRED_MESSAGE,
                }
            )
    for image in package["card_images"]:
        if not find_imported_card(
            db,
            {"id": image.get("gift_card_id")},
            source_environment,
        ):
            missing.append(
                {
                    "entity": "card_image",
                    "source_id": image.get("id"),
                    "missing": "imported_gift_card",
                    "missing_source_id": image.get("gift_card_id"),
                    "message": IMAGE_PACKAGE_CORE_REQUIRED_MESSAGE,
                }
            )
    return missing


def image_package_duplicate_receipts(
    db: Session,
    package: dict,
    source_environment: str | None,
) -> set[int]:
    duplicates = set()
    for receipt in package["receipts"]:
        purchase = find_imported_purchase(
            db,
            {"id": receipt.get("purchase_batch_id")},
            source_environment,
        )
        if not purchase:
            continue
        query = db.query(Receipt).filter(Receipt.purchase_batch_id == purchase.id)
        if receipt.get("original_filename"):
            query = query.filter(Receipt.original_filename == receipt.get("original_filename"))
        elif receipt.get("image_url"):
            query = query.filter(Receipt.image_url == receipt.get("image_url"))
        else:
            continue
        if query.first():
            duplicates.add(receipt.get("id"))
    return duplicates


def image_package_duplicate_card_images(
    db: Session,
    package: dict,
    source_environment: str | None,
) -> set[int]:
    duplicates = set()
    for image in package["card_images"]:
        card = find_imported_card(
            db,
            {"id": image.get("gift_card_id")},
            source_environment,
        )
        if not card:
            continue
        query = db.query(CardImage).filter(CardImage.gift_card_id == card.id)
        query = query.filter(CardImage.image_type == (image.get("image_type") or "primary"))
        if image.get("original_filename"):
            query = query.filter(CardImage.original_filename == image.get("original_filename"))
        elif image.get("original_image_url"):
            query = query.filter(CardImage.original_image_url == image.get("original_image_url"))
        else:
            continue
        if query.first():
            duplicates.add(image.get("id"))
    return duplicates


def missing_dependency_messages(package: dict) -> list[dict]:
    purchase_ids = {purchase.get("id") for purchase in package["purchases"]}
    card_ids = {card.get("id") for card in package["cards"]}
    sale_ids = {sale.get("id") for sale in package["sales"]}
    buyer_ids = {buyer.get("id") for buyer in package["buyers"]}
    fuel_account_ids = {account.get("id") for account in package["fuel_accounts"]}
    messages = []

    for sale in package["sales"]:
        if sale.get("buyer_id") not in buyer_ids:
            messages.append(
                {
                    "entity": "sale",
                    "source_id": sale.get("id"),
                    "missing": "buyer",
                    "missing_source_id": sale.get("buyer_id"),
                }
            )
    for card in package["cards"]:
        if card.get("purchase_batch_id") not in purchase_ids:
            messages.append(
                {
                    "entity": "gift_card",
                    "source_id": card.get("id"),
                    "missing": "purchase_batch",
                    "missing_source_id": card.get("purchase_batch_id"),
                }
            )
    for link in package["sale_gift_cards"]:
        if link.get("sale_id") not in sale_ids:
            messages.append(
                {
                    "entity": "sale_gift_card",
                    "source_id": link.get("id"),
                    "missing": "sale",
                    "missing_source_id": link.get("sale_id"),
                }
            )
        if link.get("gift_card_id") not in card_ids:
            messages.append(
                {
                    "entity": "sale_gift_card",
                    "source_id": link.get("id"),
                    "missing": "gift_card",
                    "missing_source_id": link.get("gift_card_id"),
                }
            )
    for link in package["sale_fuel_accounts"]:
        if link.get("sale_id") not in sale_ids:
            messages.append(
                {
                    "entity": "sale_fuel_account",
                    "source_id": link.get("id"),
                    "missing": "sale",
                    "missing_source_id": link.get("sale_id"),
                }
            )
        if link.get("fuel_reward_account_id") not in fuel_account_ids:
            messages.append(
                {
                    "entity": "sale_fuel_account",
                    "source_id": link.get("id"),
                    "missing": "fuel_reward_account",
                    "missing_source_id": link.get("fuel_reward_account_id"),
                }
            )
    return messages


def duplicate_card_payload(
    *,
    source: dict,
    duplicate: GiftCard,
    matched_value: str | None,
    match_type: str,
) -> dict:
    return {
        "source_id": source.get("id"),
        "existing_id": duplicate.id,
        "brand": source.get("brand"),
        "card_ending": credential_ending(matched_value),
        "match_type": match_type,
    }


def find_sensitive_duplicate_card(
    db: Session,
    source: dict,
    source_environment: str | None,
) -> tuple[GiftCard | None, str | None, str, bool]:
    if source_environment and source.get("id") is not None:
        imported_duplicate = (
            db.query(GiftCard)
            .filter(GiftCard.imported_from_environment == source_environment)
            .filter(GiftCard.imported_source_id == str(source.get("id")))
            .first()
        )
        if imported_duplicate:
            return (
                imported_duplicate,
                source.get("confirmed_redemption_code")
                or source.get("confirmed_card_number")
                or source.get("card_number_encrypted"),
                "imported_source_id",
                False,
            )

    source_cards = source_card_values(source)
    source_pins = source_pin_values(source)
    if not source_cards:
        return None, None, "", False

    duplicate_check_limited = False
    candidates = (
        db.query(GiftCard)
        .filter(GiftCard.brand == source.get("brand"))
        .order_by(GiftCard.id.asc())
        .all()
    )
    for candidate in candidates:
        target_cards, target_pins, unavailable = target_card_values(candidate)
        duplicate_check_limited = duplicate_check_limited or unavailable
        matched_cards = source_cards & target_cards
        if not matched_cards:
            continue
        if source_pins and target_pins and not (source_pins & target_pins):
            continue
        return candidate, sorted(matched_cards)[0], "credential", duplicate_check_limited

    return None, None, "", duplicate_check_limited


def find_imported_card(
    db: Session,
    source: dict,
    source_environment: str | None,
) -> GiftCard | None:
    if not source_environment or source.get("id") is None:
        return None
    return (
        db.query(GiftCard)
        .filter(GiftCard.imported_from_environment == source_environment)
        .filter(GiftCard.imported_source_id == str(source.get("id")))
        .first()
    )


def find_standard_duplicate_card(db: Session, source: dict) -> GiftCard | None:
    if not source.get("card_number_encrypted"):
        return None
    duplicate = (
        db.query(GiftCard)
        .filter(GiftCard.brand == source.get("brand"))
        .filter(GiftCard.card_number_encrypted == source.get("card_number_encrypted"))
    )
    if source.get("pin_encrypted"):
        duplicate = duplicate.filter(GiftCard.pin_encrypted == source.get("pin_encrypted"))
    return duplicate.first()


def find_duplicate_card_for_import(
    db: Session,
    source: dict,
    package: dict,
) -> tuple[GiftCard | None, dict | None, bool]:
    imported_duplicate = find_imported_card(
        db,
        source,
        package["manifest"].get("source_environment"),
    )
    if imported_duplicate:
        matched_value = (
            source.get("confirmed_redemption_code")
            or source.get("confirmed_card_number")
            or source.get("card_number_encrypted")
        )
        return (
            imported_duplicate,
            duplicate_card_payload(
                source=source,
                duplicate=imported_duplicate,
                matched_value=matched_value,
                match_type="imported_source_id",
            ),
            False,
        )

    if package["manifest"].get("sensitive_transfer"):
        duplicate, matched_value, match_type, limited = find_sensitive_duplicate_card(
            db,
            source,
            package["manifest"].get("source_environment"),
        )
        if not duplicate:
            return None, None, limited
        return (
            duplicate,
            duplicate_card_payload(
                source=source,
                duplicate=duplicate,
                matched_value=matched_value,
                match_type=match_type,
            ),
            limited,
        )

    duplicate = find_standard_duplicate_card(db, source)
    if not duplicate:
        return None, None, False
    return (
        duplicate,
        duplicate_card_payload(
            source=source,
            duplicate=duplicate,
            matched_value=source.get("card_number_encrypted"),
            match_type="encrypted_value",
        ),
        False,
    )


def apply_image_package(db: Session, package: dict) -> dict:
    preview = preview_image_package(db, package)
    if preview["conflicts"].get("missing_dependencies"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "missing_core_records",
                "message": IMAGE_PACKAGE_CORE_REQUIRED_MESSAGE,
                "conflicts": preview["conflicts"]["missing_dependencies"],
            },
        )

    imported_at = utc_now()
    source_environment = package["manifest"].get("source_environment")
    raw_zip = ZipFile(BytesIO(package["_raw"]))
    duplicate_receipts = image_package_duplicate_receipts(
        db,
        package,
        source_environment,
    )
    duplicate_card_images = image_package_duplicate_card_images(
        db,
        package,
        source_environment,
    )
    created_receipts = 0
    created_card_images = 0

    for source in package["receipts"]:
        if source.get("id") in duplicate_receipts:
            continue
        purchase = find_imported_purchase(
            db,
            {"id": source.get("purchase_batch_id")},
            source_environment,
        )
        if not purchase:
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
        if not image_url:
            continue
        db.add(
            Receipt(
                purchase_batch_id=purchase.id,
                image_url=image_url,
                original_filename=source.get("original_filename"),
                notes=source.get("notes"),
            )
        )
        created_receipts += 1

    for source in package["card_images"]:
        if source.get("id") in duplicate_card_images:
            continue
        card = find_imported_card(
            db,
            {"id": source.get("gift_card_id")},
            source_environment,
        )
        if not card:
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
        if not image_url:
            continue
        db.add(
            CardImage(
                gift_card_id=card.id,
                image_type=source.get("image_type") or "primary",
                original_image_url=image_url,
                original_filename=source.get("original_filename"),
                processed_image_url=source.get("processed_image_url"),
                canonical_rotation_degrees=source.get("canonical_rotation_degrees"),
                orientation_source=source.get("orientation_source"),
                canonical_transform_metadata=source.get(
                    "canonical_transform_metadata"
                ),
            )
        )
        created_card_images += 1

    db.commit()
    return {
        "imported_at": imported_at,
        "source_environment": source_environment,
        "created": {
            "purchases": 0,
            "cards": 0,
            "sales": 0,
            "receipts": created_receipts,
            "card_images": created_card_images,
        },
        "skipped": {
            "duplicate_cards": 0,
            "duplicate_receipts": len(duplicate_receipts),
            "duplicate_card_images": len(duplicate_card_images),
        },
    }


@router.post("/import/apply")
async def apply_transfer(
    file: UploadFile = File(...),
    allow_duplicates: bool = False,
    acknowledge_sensitive: bool = False,
):
    contents = await file.read()
    package = load_package(contents)
    is_sensitive_transfer = bool(package["manifest"].get("sensitive_transfer"))
    if is_sensitive_transfer:
        require_sensitive_transfer_enabled("import")
        require_sensitive_acknowledgement(acknowledge_sensitive)

    db: Session = SessionLocal()

    try:
        if package["manifest"].get("package_type") == "linked_images":
            return apply_image_package(db, package)

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
        if preview["conflicts"].get("missing_dependencies"):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "missing_dependencies",
                    "message": "Transfer package is missing required linked records.",
                    "conflicts": preview["conflicts"]["missing_dependencies"],
                },
            )

        purchase_map: dict[int, int] = {}
        card_map: dict[int, int] = {}
        sale_map: dict[int, int] = {}
        credit_card_map: dict[int, int] = {}
        player_map: dict[int, int] = {}
        reward_program_map: dict[int, int] = {}
        spending_category_map: dict[int, int] = {}
        reused_sale_source_ids: set[int] = set()
        created_purchase_count = 0
        created_card_count = 0
        created_sale_count = 0
        imported_at = utc_now()
        source_environment = package["manifest"].get("source_environment")

        for source in package["players"]:
            player = db.query(Player).filter(Player.label == source["label"]).first()
            if not player:
                player = Player(
                    label=source["label"],
                    name=source.get("name"),
                    notes=source.get("notes"),
                    active=source.get("active", True),
                    created_at=parse_datetime(source.get("created_at")) or imported_at,
                    updated_at=imported_at,
                )
                db.add(player)
                db.flush()
            player_map[source["id"]] = player.id

        for source in package["reward_programs"]:
            program = (
                db.query(RewardProgram)
                .filter(RewardProgram.short_code == source["short_code"])
                .first()
            )
            if not program:
                program = RewardProgram(
                    name=source["name"],
                    short_code=source["short_code"],
                    category=source.get("category") or "other",
                    estimated_value_cents_per_point=source.get(
                        "estimated_value_cents_per_point"
                    ),
                    value_unit=source.get("value_unit"),
                    eligible_for_credit_cards=source.get(
                        "eligible_for_credit_cards",
                        True,
                    ),
                    transferable=source.get("transferable", False),
                    active=source.get("active", True),
                    notes=source.get("notes"),
                    created_at=parse_datetime(source.get("created_at")) or imported_at,
                    updated_at=imported_at,
                )
                db.add(program)
                db.flush()
            reward_program_map[source["id"]] = program.id

        for source in package["spending_categories"]:
            category = (
                db.query(SpendingCategory)
                .filter(SpendingCategory.key == source["key"])
                .first()
            )
            if not category:
                category = SpendingCategory(
                    key=source["key"],
                    name=source["name"],
                    active=source.get("active", True),
                    notes=source.get("notes"),
                    created_at=parse_datetime(source.get("created_at")) or imported_at,
                )
                db.add(category)
                db.flush()
            spending_category_map[source["id"]] = category.id

        for source in package["credit_cards"]:
            card = (
                db.query(CreditCard)
                .filter(CreditCard.nickname == source["nickname"])
                .filter(CreditCard.last_four == source.get("last_four"))
                .first()
            )
            if not card:
                card = CreditCard(
                    player_id=player_map.get(source.get("player_id")),
                    nickname=source["nickname"],
                    issuer=source.get("issuer") or "Unknown",
                    network=source.get("network"),
                    last_four=source.get("last_four"),
                    credit_limit=source.get("credit_limit"),
                    current_balance=source.get("current_balance"),
                    is_active=source.get("is_active", True),
                    created_at=parse_datetime(source.get("created_at")) or imported_at,
                    updated_at=imported_at,
                )
                db.add(card)
                db.flush()
            credit_card_map[source["id"]] = card.id

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

        for source in package["purchases"]:
            duplicate_purchase = find_duplicate_purchase(
                db,
                source,
                source_environment,
            )
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
                credit_card_id=credit_card_map.get(source.get("credit_card_id")),
                player_id=player_map.get(source.get("player_id")),
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
            duplicate, payload, _ = find_duplicate_card_for_import(db, source, package)
            if duplicate and payload and payload.get("match_type") == "imported_source_id":
                card_map[source["id"]] = duplicate.id
                continue
            if duplicate and not allow_duplicates:
                continue

            card = GiftCard(
                purchase_batch_id=purchase_map[source["purchase_batch_id"]],
                brand=source["brand"],
                face_value=source.get("face_value") or 0,
                acquisition_cost=source.get("acquisition_cost"),
                status=source.get("status") or "NEEDS_VERIFICATION",
                card_source=source.get("card_source") or "physical",
                card_number_encrypted=encrypt_field(
                    source.get("card_number_encrypted")
                ),
                pin_encrypted=encrypt_field(source.get("pin_encrypted")),
                confirmed_card_number=encrypt_field(
                    source.get("confirmed_card_number")
                    or source.get("card_number_encrypted")
                ),
                confirmed_pin=encrypt_field(
                    source.get("confirmed_pin") or source.get("pin_encrypted")
                ),
                confirmed_redemption_code=encrypt_field(
                    source.get("confirmed_redemption_code")
                ),
                confirmed_at=parse_datetime(source.get("confirmed_at")),
                confirmed_source=source.get("confirmed_source"),
                sold_to=source.get("sold_to"),
                sold_date=parse_date(source.get("sold_date")),
                sale_price=source.get("sale_price"),
                sale_notes=source.get("sale_notes"),
                asking_price=source.get("asking_price"),
                expected_payout=source.get("expected_payout"),
                liquidation_rate=source.get("liquidation_rate"),
                buyer_id=buyer_by_source.get(source.get("buyer_id")).id
                if "buyer_by_source" in locals()
                and buyer_by_source.get(source.get("buyer_id"))
                else None,
                reserved_at=parse_datetime(source.get("reserved_at")),
                sold_at=parse_datetime(source.get("sold_at")),
                expected_payment_date=parse_date(source.get("expected_payment_date")),
                settlement_payment_account_id=(
                    payment_by_source.get(source.get("settlement_payment_account_id")).id
                    if "payment_by_source" in locals()
                    and payment_by_source.get(source.get("settlement_payment_account_id"))
                    else None
                ),
                settlement_received_at=parse_datetime(source.get("settlement_received_at")),
                payout_received=source.get("payout_received"),
                internal_notes=source.get("internal_notes"),
                verified_balance=source.get("verified_balance"),
                verified_at=parse_datetime(source.get("verified_at")),
                verification_notes=source.get("verification_notes"),
                verification_source=source.get("verification_source"),
                verification_status=source.get("verification_status") or "PENDING",
                detected_card_number=encrypt_field(source.get("detected_card_number")),
                detected_pin=encrypt_field(source.get("detected_pin")),
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
            created_card_count += 1

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
                    login_password=encrypt_field(source.get("login_password")),
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

        for source in package["purchase_payments"]:
            if source.get("purchase_batch_id") not in purchase_map:
                continue
            existing_payment = (
                db.query(PurchasePayment)
                .filter(
                    PurchasePayment.purchase_batch_id
                    == purchase_map[source["purchase_batch_id"]]
                )
                .filter(PurchasePayment.payment_type == source.get("payment_type"))
                .filter(PurchasePayment.amount == parse_decimal(source.get("amount")))
                .first()
            )
            if existing_payment:
                continue
            db.add(
                PurchasePayment(
                    purchase_batch_id=purchase_map[source["purchase_batch_id"]],
                    payment_type=source.get("payment_type") or "credit_card",
                    credit_card_id=credit_card_map.get(source.get("credit_card_id")),
                    reward_program_id=reward_program_map.get(
                        source.get("reward_program_id")
                    ),
                    spending_category_id=spending_category_map.get(
                        source.get("spending_category_id")
                    ),
                    matched_rule_id=None,
                    amount=source.get("amount") or 0,
                    reward_multiplier=source.get("reward_multiplier"),
                    estimated_rewards_earned=source.get("estimated_rewards_earned"),
                    applied_multiplier=source.get("applied_multiplier"),
                    calculated_rewards=source.get("calculated_rewards"),
                    reward_type=source.get("reward_type"),
                    points_earned=source.get("points_earned"),
                    cashback_amount=source.get("cashback_amount"),
                    statement_credit_amount=source.get("statement_credit_amount"),
                    purchase_discount_amount=source.get("purchase_discount_amount"),
                    effective_savings_amount=source.get("effective_savings_amount"),
                    priority=source.get("priority"),
                    calculation_source=source.get("calculation_source"),
                    credit_card_product_snapshot=source.get(
                        "credit_card_product_snapshot"
                    ),
                    rewards_type=source.get("rewards_type"),
                    notes=source.get("notes"),
                    created_at=parse_datetime(source.get("created_at")) or imported_at,
                )
            )

        for source in package["fuel_transactions"]:
            if source.get("purchase_batch_id") not in purchase_map:
                continue
            account = fuel_account_by_source.get(source["fuel_reward_account_id"])
            if not account:
                continue
            existing_entry = (
                db.query(FuelPointEntry)
                .filter(FuelPointEntry.purchase_batch_id == purchase_map[source["purchase_batch_id"]])
                .filter(FuelPointEntry.fuel_reward_account_id == account.id)
                .filter(FuelPointEntry.earned_date == parse_date(source["earned_date"]))
                .filter(FuelPointEntry.points_earned == (source.get("points_earned") or 0))
                .first()
            )
            if existing_entry:
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
            imported_sale = find_imported_sale(db, source, source_environment)
            if imported_sale:
                sale_map[source["id"]] = imported_sale.id
                reused_sale_source_ids.add(source["id"])
                continue
            buyer = buyer_by_source.get(source["buyer_id"])
            if not buyer:
                continue
            sale = Sale(
                buyer_id=buyer.id,
                sold_at=parse_datetime(source.get("sold_at")) or imported_at,
                expected_payout=source.get("expected_payout") or 0,
                card_payout_rate=source.get("card_payout_rate"),
                fuel_rate_per_1000=source.get("fuel_rate_per_1000"),
                expected_payment_date=parse_datetime(
                    source.get("expected_payment_date")
                ),
                payout_received=source.get("payout_received"),
                payment_account_id=(
                    payment_by_source.get(source.get("payment_account_id")).id
                    if payment_by_source.get(source.get("payment_account_id"))
                    else None
                ),
                status=source.get("status") or "SOLD_PENDING_PAYMENT",
                buyer_reference=source.get("buyer_reference"),
                internal_tags=source.get("internal_tags"),
                export_profile=source.get("export_profile"),
                settlement_status_notes=source.get("settlement_status_notes"),
                manual_payout_override_amount=source.get(
                    "manual_payout_override_amount"
                ),
                linked_external_reference_ids=source.get(
                    "linked_external_reference_ids"
                ),
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
            created_sale_count += 1

        for source in package["sale_gift_cards"]:
            if source.get("sale_id") in sale_map and source.get("gift_card_id") in card_map:
                existing_link = (
                    db.query(SaleGiftCard)
                    .filter(SaleGiftCard.sale_id == sale_map[source["sale_id"]])
                    .filter(
                        SaleGiftCard.gift_card_id == card_map[source["gift_card_id"]]
                    )
                    .first()
                )
                if existing_link:
                    continue
                db.add(
                    SaleGiftCard(
                        sale_id=sale_map[source["sale_id"]],
                        gift_card_id=card_map[source["gift_card_id"]],
                        expected_payout=source.get("expected_payout"),
                        payout_received=source.get("payout_received"),
                        payment_account_id=(
                            payment_by_source.get(
                                source.get("payment_account_id")
                            ).id
                            if payment_by_source.get(source.get("payment_account_id"))
                            else None
                        ),
                        settlement_received_at=parse_datetime(
                            source.get("settlement_received_at")
                        ),
                        adjustment_amount=source.get("adjustment_amount"),
                        adjustment_reason=source.get("adjustment_reason"),
                        settlement_notes=source.get("settlement_notes"),
                        created_at=parse_datetime(source.get("created_at"))
                        or imported_at,
                    )
                )

        for source in package["sale_fuel_accounts"]:
            account = fuel_account_by_source.get(source.get("fuel_reward_account_id"))
            if source.get("sale_id") in sale_map and account:
                existing_link = (
                    db.query(SaleFuelAccount)
                    .filter(SaleFuelAccount.sale_id == sale_map[source["sale_id"]])
                    .filter(SaleFuelAccount.fuel_reward_account_id == account.id)
                    .first()
                )
                if existing_link:
                    continue
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
                        payment_account_id=(
                            payment_by_source.get(
                                source.get("payment_account_id")
                            ).id
                            if payment_by_source.get(source.get("payment_account_id"))
                            else None
                        ),
                        settlement_received_at=parse_datetime(
                            source.get("settlement_received_at")
                        ),
                        adjustment_amount=source.get("adjustment_amount"),
                        adjustment_reason=source.get("adjustment_reason"),
                        settlement_notes=source.get("settlement_notes"),
                        created_at=parse_datetime(source.get("created_at"))
                        or imported_at,
                    )
                )

        for source in package["sale_events"]:
            if source.get("sale_id") not in sale_map:
                continue
            if source.get("sale_id") in reused_sale_source_ids:
                continue
            db.add(
                SaleEvent(
                    sale_id=sale_map[source["sale_id"]],
                    action=source.get("action") or "imported",
                    affected_asset_count=source.get("affected_asset_count"),
                    user_label=source.get("user_label"),
                    field_name=source.get("field_name"),
                    old_value=source.get("old_value"),
                    new_value=source.get("new_value"),
                    reason=source.get("reason"),
                    notes=source.get("notes"),
                    created_at=parse_datetime(source.get("created_at")) or imported_at,
                )
            )

        raw_zip = ZipFile(BytesIO(package["_raw"]))
        duplicate_receipt_ids = image_package_duplicate_receipts(
            db,
            package,
            source_environment,
        )
        duplicate_card_image_ids = image_package_duplicate_card_images(
            db,
            package,
            source_environment,
        )
        for source in package["receipts"]:
            if source.get("id") in duplicate_receipt_ids:
                continue
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
            if source.get("id") in duplicate_card_image_ids:
                continue
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
                        original_filename=source.get("original_filename"),
                        processed_image_url=source.get("processed_image_url"),
                        canonical_rotation_degrees=source.get(
                            "canonical_rotation_degrees"
                        ),
                        orientation_source=source.get("orientation_source"),
                        canonical_transform_metadata=source.get(
                            "canonical_transform_metadata"
                        ),
                    )
                )

        db.commit()
        return {
            "imported_at": imported_at,
            "source_environment": source_environment,
            "created": {
                "purchases": created_purchase_count,
                "cards": created_card_count,
                "sales": created_sale_count,
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
