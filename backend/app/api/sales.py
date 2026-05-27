import json
from datetime import date, datetime, timedelta
from app.utils.time import utc_now
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.app_setting import AppSetting
from app.models.buyer import Buyer
from app.models.card_image import CardImage
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.fuel_point_entry import FuelPointEntry
from app.models.gift_card import GiftCard
from app.models.payment_account import PaymentAccount
from app.models.receipt import Receipt
from app.models.sale import Sale
from app.models.sale_event import SaleEvent
from app.models.sale_fuel_account import SaleFuelAccount
from app.models.sale_gift_card import SaleGiftCard
from app.services.field_encryption import decrypt_field, encrypt_field
from app.services.operational_queues import get_awaiting_payment_sales
from app.services.upload_storage import physical_upload_path
from app.services.storage import normalize_object_key, storage


router = APIRouter(prefix="/sales", tags=["sales"])

DEFAULT_CARD_EXPORT_FORMAT = "brand,face_value,card_number,pin"
DEFAULT_FUEL_EXPORT_FORMAT = "retailer,points_sold,email_login,password,alt_id"
VOIDED_SALE_EXPORT_RETENTION_KEY = "voided_sale_sensitive_export_retention"
VOIDED_SALE_EXPORT_RETENTION_DEFAULT = "never"


class SaleFuelAccountCreate(BaseModel):
    fuel_reward_account_id: int
    points_sold: int
    expected_value: Decimal | None = None
    is_full_account_sale: bool = True
    login_password: str | None = None
    fuel_overage_override: bool = False


class SaleCreate(BaseModel):
    buyer_id: int
    sold_at: datetime | None = None
    sold_date: date | None = None
    expected_payment_date: date | None = None
    payment_account_id: int | None = None
    card_payout_rate: Decimal | None = None
    fuel_rate_per_1000: Decimal | None = None
    expected_payout: Decimal
    notes: str | None = None
    gift_card_ids: list[int] = []
    fuel_accounts: list[SaleFuelAccountCreate] = []


class SaleSettle(BaseModel):
    payout_received: Decimal
    settlement_received_at: datetime | None = None
    payment_account_id: int | None = None
    notes: str | None = None


class SaleAssetSettle(BaseModel):
    gift_card_ids: list[int] = []
    fuel_account_ids: list[int] = []
    payout_received: Decimal
    settlement_received_at: datetime | None = None
    payment_account_id: int | None = None
    adjustment_amount: Decimal | None = None
    adjustment_reason: str | None = None
    notes: str | None = None


class SaleVoid(BaseModel):
    notes: str | None = None


class SaleEdit(BaseModel):
    buyer_id: int | None = None
    expected_payment_date: date | None = None
    expected_payout: Decimal | None = None
    payment_account_id: int | None = None
    buyer_reference: str | None = None
    notes: str | None = None
    internal_tags: str | None = None
    export_profile: str | None = None
    settlement_status_notes: str | None = None
    manual_payout_override_amount: Decimal | None = None
    card_payout_rate: Decimal | None = None
    fuel_rate_per_1000: Decimal | None = None
    sold_at: datetime | None = None
    sold_date: date | None = None
    linked_external_reference_ids: str | None = None
    reason: str | None = None
    user_label: str | None = None


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    return Decimal(str(value))


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def normalize_payout_rate(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None

    rate = to_decimal(value)
    if Decimal("0") < rate < Decimal("1"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_payout_rate_format",
                "message": "Enter payout rate as a percentage.",
            },
        )

    rate = rate / Decimal("100")

    return rate.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def round_down_to_thousand(points: int) -> int:
    return max(0, int(points) // 1000 * 1000)


def clean_filename_part(value) -> str:
    cleaned = "".join(
        character.lower() if character.isalnum() else "-"
        for character in str(value or "")
    ).strip("-")
    return cleaned or "file"


def clean_folder_part(value) -> str:
    cleaned = "".join(
        character if character.isalnum() or character in {" ", "-", "_"} else "-"
        for character in str(value or "")
    ).strip(" -_")
    return cleaned or "Folder"


def file_extension(path: str) -> str:
    extension = Path(path).suffix.lower()
    safe_extension = "".join(
        character for character in extension if character.isalnum() or character == "."
    )
    return safe_extension if safe_extension and len(safe_extension) <= 8 else ".jpg"


def local_upload_path(path_or_url: str | None) -> Path | None:
    if not path_or_url:
        return None

    parsed_path = (
        urlparse(path_or_url).path
        if path_or_url.startswith(("http://", "https://"))
        else path_or_url
    )
    candidates = [
        physical_upload_path(path_or_url),
        Path(parsed_path),
        Path(parsed_path.lstrip("/")),
    ]

    for candidate in candidates:
        if candidate is None:
            continue
        if candidate.exists() and candidate.is_file():
            return candidate

    return None


def sale_package_filename(
    sale: Sale,
    buyer_slug: str,
    sale_date: str,
    card_count: int,
    fuel_account_count: int,
) -> str:
    return (
        f"sale_{sale.id}_{buyer_slug}_{sale_date}_"
        f"cards_{card_count}_fuel_{fuel_account_count}.zip"
    )


def sale_package_root(sale: Sale, buyer_slug: str, sale_date: str) -> str:
    return f"sale_{sale.id}_{buyer_slug}_{sale_date}"


def unique_archive_name(
    used_names: set[str],
    stem: str,
    extension: str,
) -> str:
    name = f"{stem}{extension}"

    if name not in used_names:
        used_names.add(name)
        return name

    index = 2
    while True:
        candidate = f"{stem}_{index}{extension}"
        if candidate not in used_names:
            used_names.add(candidate)
            return candidate
        index += 1


def sale_export_extension(buyer: Buyer) -> str:
    return "csv" if (buyer.preferred_export_type or "TXT") == "CSV" else "txt"


def export_delimiter(buyer: Buyer) -> str:
    return "\t" if (buyer.preferred_export_type or "TXT") in {"GOOGLE_SHEETS_PASTE", "TSV"} else ","


def brand_folder(card: GiftCard) -> str:
    return card.brand or "Unknown Brand"


def grouped_cards_by_brand(cards: list[GiftCard]) -> dict[str, list[GiftCard]]:
    grouped_cards: dict[str, list[GiftCard]] = {}
    for card in sorted(cards, key=card_export_sort_key):
        grouped_cards.setdefault(brand_folder(card), []).append(card)
    return dict(sorted(grouped_cards.items(), key=lambda item: item[0].lower()))


def card_image_archive_stem(card: GiftCard) -> str:
    card_last4 = ending(locked_card_number(card))
    parts = [
        clean_filename_part(card.brand),
        clean_filename_part(card.face_value),
        clean_filename_part(card_last4) if card_last4 else f"card-{card.id}",
    ]
    return "_".join(part for part in parts if part)


def fuel_account_export_text(row: SaleFuelAccount, account: FuelRewardAccount) -> str:
    login_password = decrypt_field(account.login_password) or ""
    lines = [
        f"retailer: {account.retailer}",
        f"points_sold: {row.points_sold}",
        f"email_login: {account.email or ''}",
        f"password: {login_password}",
        f"alt_id: {account.alt_id or ''}",
    ]
    return "\n".join(lines) + "\n"


def build_sale_package_manifest(
    sale: Sale,
    buyer: Buyer,
    card_rows: list[tuple[SaleGiftCard, GiftCard]],
    fuel_rows: list[tuple[SaleFuelAccount, FuelRewardAccount]],
    sale_date: str,
    organization: str,
) -> dict:
    return {
        "sale_id": sale.id,
        "buyer": buyer.name,
        "sold_date": sale_date,
        "expected_payout": str(sale.expected_payout or ""),
        "status": sale.status,
        "zip_organization": organization,
        "gift_card_count": len(card_rows),
        "fuel_account_count": len(fuel_rows),
        "gift_cards_by_brand": {
            brand: [card.id for card in rows]
            for brand, rows in grouped_cards_by_brand([card for _, card in card_rows]).items()
        },
        "fuel_accounts": [
            {
                "id": account.id,
                "retailer": account.retailer,
                "points_sold": row.points_sold,
            }
            for row, account in fuel_rows
        ],
    }


def archive_text(
    archive: ZipFile,
    used_archive_names: set[str],
    base_path: str,
    stem: str,
    extension: str,
    content: str,
) -> str:
    archive_name = unique_archive_name(
        used_archive_names,
        f"{base_path}/{stem}" if base_path else stem,
        extension,
    )
    archive.writestr(archive_name, content)
    return archive_name


def archive_file(
    archive: ZipFile,
    used_archive_names: set[str],
    source_path: Path | str,
    base_path: str,
    stem: str,
    extension: str,
) -> str:
    archive_name = unique_archive_name(
        used_archive_names,
        f"{base_path}/{stem}" if base_path else stem,
        extension,
    )
    try:
        archive.writestr(archive_name, storage.read(normalize_object_key(str(source_path))))
    except Exception:
        archive.write(source_path, archive_name)
    return archive_name


def buyer_expected_payment_date(buyer: Buyer, sold_at: datetime) -> date | None:
    if buyer.default_payout_days is None:
        return None

    return sold_at.date() + timedelta(days=buyer.default_payout_days)


def template_fields(template: str) -> list[str]:
    return [
        field.strip().strip("{}").strip()
        for field in template.split(",")
    ]


def render_asset_export(
    *,
    template: str,
    rows: list[dict[str, str]],
    delimiter: str,
    include_header: bool,
) -> str:
    fields = template_fields(template)
    output_rows: list[str] = []

    if include_header:
        output_rows.append(delimiter.join(fields))

    for row in rows:
        output_rows.append(delimiter.join(row.get(field, "") for field in fields))

    return "\n".join(output_rows)


def card_export_values(card: GiftCard) -> dict[str, str]:
    card_number = locked_card_number(card)
    pin = locked_pin(card)
    redemption_code = decrypt_field(card.confirmed_redemption_code) or ""
    return {
        "brand": card.brand,
        "face_value": str(card.face_value),
        "card_number": card_number,
        "pin": pin,
        "redemption_code": redemption_code,
        "confirmed_source": card.confirmed_source or "",
        "export_value_source": "confirmed_credentials" if card_number else "unconfirmed",
        "card_id": str(card.id),
        "gift_card_id": str(card.id),
        "purchase_id": str(card.purchase_batch_id),
        "purchase_batch_id": str(card.purchase_batch_id),
        "card_number_last4": ending(card_number) or "",
        "pin_last4": ending(pin) or "",
    }


def card_export_sort_key(card: GiftCard) -> tuple[str, Decimal, str]:
    return (
        (card.brand or "Unknown Brand").lower(),
        -to_decimal(card.face_value),
        locked_card_number(card),
    )


def card_export_should_group_by_brand(template: str) -> bool:
    return "brand" not in {field.lower() for field in template_fields(template)}


def grouped_card_export_text(
    *,
    cards: list[GiftCard],
    template: str,
    delimiter: str,
) -> str:
    grouped_cards: dict[str, list[GiftCard]] = {}

    for card in sorted(cards, key=card_export_sort_key):
        grouped_cards.setdefault(card.brand or "Unknown Brand", []).append(card)

    sections: list[str] = []

    for brand in sorted(grouped_cards, key=lambda value: value.lower()):
        brand_cards = grouped_cards[brand]
        brand_rows = render_asset_export(
            template=template,
            rows=[card_export_values(card) for card in brand_cards],
            delimiter=delimiter,
            include_header=False,
        )
        sections.append(f"{brand}\n{brand_rows}" if brand_rows else brand)

    return "\n\n".join(sections)


def fuel_export_values(
    row: SaleFuelAccount,
    account: FuelRewardAccount,
) -> dict[str, str]:
    login_password = decrypt_field(account.login_password) or ""
    return {
        "retailer": account.retailer,
        "points_sold": str(row.points_sold),
        "email_login": account.email or "",
        "email": account.email or "",
        "login": account.email or "",
        "password": login_password,
        "login_password": login_password,
        "alt_id": account.alt_id or "",
        "fuel_account_id": str(account.id),
        "account_id": str(account.id),
        "expected_value": str(row.expected_value or ""),
        "barcode_value": account.barcode_value or "",
    }


def fuel_account_current_points(db: Session, account_id: int) -> int:
    current_points = (
        db.query(func.coalesce(func.sum(FuelPointEntry.points_earned), 0))
        .filter(FuelPointEntry.fuel_reward_account_id == account_id)
        .filter(FuelPointEntry.expires_on >= date.today())
        .scalar()
    )

    return int(current_points or 0)


def append_note(existing_note: str | None, next_note: str) -> str:
    return f"{existing_note}\n{next_note}" if existing_note else next_note


def serialize_audit_value(value) -> str | None:
    if value is None:
        return None

    if isinstance(value, (date, datetime)):
        return value.isoformat()

    return str(value)


def values_match(left, right) -> bool:
    return serialize_audit_value(left) == serialize_audit_value(right)


def record_sale_event(
    db: Session,
    sale: Sale,
    action: str,
    affected_asset_count: int | None = None,
    notes: str | None = None,
    user_label: str | None = None,
    field_name: str | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
    reason: str | None = None,
) -> None:
    db.add(
        SaleEvent(
            sale_id=sale.id,
            action=action,
            affected_asset_count=affected_asset_count,
            notes=notes,
            user_label=user_label,
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
            reason=reason,
        )
    )


def record_sale_field_change(
    db: Session,
    sale: Sale,
    field_name: str,
    old_value,
    new_value,
    reason: str | None,
    user_label: str | None,
    notes: str | None = None,
) -> None:
    record_sale_event(
        db,
        sale,
        "edited",
        notes=notes,
        user_label=user_label or "system",
        field_name=field_name,
        old_value=serialize_audit_value(old_value),
        new_value=serialize_audit_value(new_value),
        reason=reason,
    )


def sale_has_export_event(db: Session, sale_id: int) -> bool:
    return (
        db.query(SaleEvent)
        .filter(SaleEvent.sale_id == sale_id)
        .filter(SaleEvent.action == "exported")
        .first()
        is not None
    )


def apply_expected_payout_change(
    db: Session,
    sale: Sale,
    new_expected_payout: Decimal,
) -> None:
    card_rows = (
        db.query(SaleGiftCard, GiftCard)
        .join(GiftCard, GiftCard.id == SaleGiftCard.gift_card_id)
        .filter(SaleGiftCard.sale_id == sale.id)
        .order_by(SaleGiftCard.id.asc())
        .all()
    )
    fuel_rows = (
        db.query(SaleFuelAccount, FuelRewardAccount)
        .join(
            FuelRewardAccount,
            FuelRewardAccount.id == SaleFuelAccount.fuel_reward_account_id,
        )
        .filter(SaleFuelAccount.sale_id == sale.id)
        .order_by(SaleFuelAccount.id.asc())
        .all()
    )
    rows = [*card_rows, *fuel_rows]

    if not rows:
        sale.expected_payout = new_expected_payout
        return

    current_total = sum(
        to_decimal(row.expected_payout)
        for row, _ in card_rows
    ) + sum(to_decimal(row.expected_value) for row, _ in fuel_rows)
    allocated_total = Decimal("0")

    for index, (row, asset) in enumerate(rows):
        if current_total <= 0:
            allocated = quantize_money(
                new_expected_payout - allocated_total
                if index == len(rows) - 1
                else new_expected_payout / Decimal(len(rows))
            )
        elif index == len(rows) - 1:
            allocated = quantize_money(new_expected_payout - allocated_total)
        else:
            current_value = (
                to_decimal(row.expected_payout)
                if isinstance(row, SaleGiftCard)
                else to_decimal(row.expected_value)
            )
            allocated = quantize_money(
                new_expected_payout * (current_value / current_total)
            )

        if index != len(rows) - 1:
            allocated_total += allocated

        if isinstance(row, SaleGiftCard):
            row.expected_payout = allocated
            asset.expected_payout = allocated
            asset.sale_price = allocated
            asset.updated_at = utc_now()
        else:
            row.expected_value = allocated
            asset.sale_price = allocated
            asset.updated_at = utc_now()

    sale.expected_payout = new_expected_payout


def get_buyer_or_404(db: Session, buyer_id: int) -> Buyer:
    buyer = db.query(Buyer).filter(Buyer.id == buyer_id).first()

    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")

    return buyer


def get_payment_account_or_404(
    db: Session,
    payment_account_id: int,
) -> PaymentAccount:
    account = (
        db.query(PaymentAccount)
        .filter(PaymentAccount.id == payment_account_id)
        .first()
    )

    if not account:
        raise HTTPException(status_code=404, detail="Payment account not found")

    return account


def serialize_payment_account_summary(account: PaymentAccount | None) -> dict | None:
    if not account:
        return None

    return {
        "id": account.id,
        "name": account.name,
        "account_type": account.account_type,
        "institution": account.institution,
        "last_four": account.last_four,
        "account_identifier": account.account_identifier,
        "payment_identifier": account.payment_identifier or account.account_identifier,
        "is_business_account": account.is_business_account,
        "bank_account_type": account.bank_account_type,
        "active": account.active,
    }


def status_label(status: str) -> str:
    labels = {
        "DRAFT": "Draft",
        "ACTIVE": "Awaiting Payment",
        "SOLD_PENDING_PAYMENT": "Awaiting Payment",
        "PARTIALLY_SETTLED": "Partially Paid",
        "COMPLETED": "Settled",
        "SETTLED": "Settled",
        "VOIDED": "Voided",
    }
    return labels.get(status, status.replace("_", " ").title())


def get_setting(db: Session, key: str, default: str) -> str:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()
    return setting.value if setting and setting.value is not None else default


def sale_voided_at(events: list[SaleEvent]) -> datetime | None:
    voided_events = [event.created_at for event in events if event.action == "voided"]
    return max(voided_events) if voided_events else None


def sale_exported_before_void(events: list[SaleEvent]) -> bool:
    voided_at = sale_voided_at(events)
    if voided_at is None:
        return any(event.action == "exported" for event in events)

    return any(
        event.action == "exported" and event.created_at <= voided_at
        for event in events
    )


def voided_sale_export_access_revoked(
    db: Session,
    sale: Sale,
    events: list[SaleEvent],
) -> bool:
    if sale.status != "VOIDED":
        return False

    policy = get_setting(
        db,
        VOIDED_SALE_EXPORT_RETENTION_KEY,
        VOIDED_SALE_EXPORT_RETENTION_DEFAULT,
    )

    if policy == "forever":
        return False

    voided_at = sale_voided_at(events)
    if voided_at is None or policy == "never":
        return True

    retention_windows = {
        "24_hours": timedelta(hours=24),
        "7_days": timedelta(days=7),
    }
    retention_window = retention_windows.get(policy)
    if retention_window is None:
        return True

    return utc_now() - voided_at > retention_window


def ensure_sale_export_access(db: Session, sale: Sale) -> None:
    events = (
        db.query(SaleEvent)
        .filter(SaleEvent.sale_id == sale.id)
        .order_by(SaleEvent.created_at.desc(), SaleEvent.id.desc())
        .all()
    )
    if voided_sale_export_access_revoked(db, sale, events):
        raise HTTPException(
            status_code=410,
            detail={
                "error": "sale_export_revoked",
                "message": "Export access was revoked because this sale was voided.",
            },
        )


def ending(value: str | None, length: int = 4) -> str | None:
    if not value:
        return None

    normalized = "".join(character for character in value if character.isalnum())
    return normalized[-length:] if normalized else None


def locked_card_number(card: GiftCard) -> str:
    return (
        decrypt_field(card.confirmed_redemption_code)
        or decrypt_field(card.confirmed_card_number)
        or decrypt_field(card.card_number_encrypted)
        or ""
    )


def locked_pin(card: GiftCard) -> str:
    return decrypt_field(card.confirmed_pin) or decrypt_field(card.pin_encrypted) or ""


def serialize_card(card: GiftCard, include_secret: bool = False) -> dict:
    card_number = locked_card_number(card)
    pin = locked_pin(card)
    data = {
        "id": card.id,
        "purchase_batch_id": card.purchase_batch_id,
        "brand": card.brand,
        "face_value": card.face_value,
        "acquisition_cost": card.acquisition_cost,
        "status": card.status,
        "card_number_ending": ending(card_number),
        "pin_ending": ending(pin),
        "confirmed_at": card.confirmed_at,
        "confirmed_source": card.confirmed_source,
        "export_value_source": "confirmed_credentials" if card_number else "unconfirmed",
        "expected_payout": card.expected_payout,
        "payout_received": card.payout_received,
        "buyer_id": card.buyer_id,
        "buyer_name": card.sold_to,
        "sold_at": card.sold_at,
        "sold_date": card.sold_date,
        "expected_payment_date": card.expected_payment_date,
        "notes": card.notes,
    }

    if include_secret:
        data["card_number_encrypted"] = card_number
        data["pin_encrypted"] = pin
        data["confirmed_card_number"] = decrypt_field(card.confirmed_card_number)
        data["confirmed_pin"] = decrypt_field(card.confirmed_pin)
        data["confirmed_redemption_code"] = decrypt_field(
            card.confirmed_redemption_code
        )

    return data


def serialize_fuel_account(account: FuelRewardAccount, row: SaleFuelAccount | None = None) -> dict:
    return {
        "id": account.id,
        "retailer": account.retailer,
        "email": account.email,
        "alt_id": account.alt_id,
        "login_password": decrypt_field(account.login_password),
        "barcode_image_url": account.barcode_image_url,
        "barcode_value": account.barcode_value,
        "status": account.status,
        "target_points": account.target_points,
        "buyer_id": account.buyer_id,
        "sold_to": account.sold_to,
        "sold_date": account.sold_date,
        "expected_payment_date": account.expected_payment_date,
        "sale_price": account.sale_price,
        "points_sold": row.points_sold if row else None,
        "expected_value": row.expected_value if row else None,
        "is_full_account_sale": row.is_full_account_sale if row else None,
        "fuel_overage_override": row.fuel_overage_override if row else None,
        "overage_points": row.overage_points if row else None,
        "payout_received": row.payout_received if row else None,
        "payment_account_id": row.payment_account_id if row else None,
        "settlement_received_at": row.settlement_received_at if row else None,
        "adjustment_amount": row.adjustment_amount if row else None,
        "adjustment_reason": row.adjustment_reason if row else None,
        "settlement_notes": row.settlement_notes if row else None,
    }


def serialize_sale_card(card: GiftCard, row: SaleGiftCard, include_secret: bool = False) -> dict:
    data = serialize_card(card, include_secret=include_secret)
    data.update(
        {
            "sale_row_id": row.id,
            "expected_payout": row.expected_payout,
            "payout_received": row.payout_received,
            "payment_account_id": row.payment_account_id,
            "settlement_received_at": row.settlement_received_at,
            "adjustment_amount": row.adjustment_amount,
            "adjustment_reason": row.adjustment_reason,
            "settlement_notes": row.settlement_notes,
            "settlement_status": "SETTLED"
            if row.settlement_received_at is not None
            else "AWAITING_PAYMENT",
        }
    )
    return data


def redact_sale_card_for_voided_export(card: dict) -> dict:
    return {
        **card,
        "card_number_ending": None,
        "pin_ending": None,
        "card_number_encrypted": None,
        "pin_encrypted": None,
        "sensitive_details_removed": True,
    }


def restored_gift_card_status(card: GiftCard) -> str:
    return "VERIFIED_AVAILABLE" if card.card_number_encrypted else "NEEDS_VERIFICATION"


def gift_card_has_nonvoid_sale(db: Session, card_id: int, sale_id: int) -> bool:
    return (
        db.query(SaleGiftCard)
        .join(Sale, Sale.id == SaleGiftCard.sale_id)
        .filter(SaleGiftCard.gift_card_id == card_id)
        .filter(SaleGiftCard.sale_id != sale_id)
        .filter(Sale.status != "VOIDED")
        .first()
        is not None
    )


def fuel_account_has_nonvoid_sale(db: Session, account_id: int, sale_id: int) -> bool:
    return (
        db.query(SaleFuelAccount)
        .join(Sale, Sale.id == SaleFuelAccount.sale_id)
        .filter(SaleFuelAccount.fuel_reward_account_id == account_id)
        .filter(SaleFuelAccount.sale_id != sale_id)
        .filter(Sale.status != "VOIDED")
        .first()
        is not None
    )


def update_sale_settlement_status(db: Session, sale: Sale) -> None:
    if sale.status == "VOIDED":
        sale.payout_received = None
        sale.updated_at = utc_now()
        return

    card_rows = (
        db.query(SaleGiftCard)
        .filter(SaleGiftCard.sale_id == sale.id)
        .all()
    )
    fuel_rows = (
        db.query(SaleFuelAccount)
        .filter(SaleFuelAccount.sale_id == sale.id)
        .all()
    )
    rows = [*card_rows, *fuel_rows]

    if not rows:
        sale.status = "ACTIVE"
        sale.payout_received = None
        sale.updated_at = utc_now()
        return

    settled_rows = [
        row for row in rows if row.settlement_received_at is not None
    ]
    sale.payout_received = sum(
        to_decimal(row.payout_received) for row in settled_rows
    ) or None

    if len(settled_rows) == 0:
        sale.status = "ACTIVE"
    elif len(settled_rows) == len(rows):
        sale.status = "COMPLETED"
    else:
        sale.status = "ACTIVE"

    sale.updated_at = utc_now()


def serialize_sale(db: Session, sale: Sale, include_secret: bool = False) -> dict:
    buyer = db.query(Buyer).filter(Buyer.id == sale.buyer_id).first()
    payment_account = (
        db.query(PaymentAccount)
        .filter(PaymentAccount.id == sale.payment_account_id)
        .first()
        if sale.payment_account_id is not None
        else None
    )
    sale_card_rows = (
        db.query(SaleGiftCard, GiftCard)
        .join(GiftCard, GiftCard.id == SaleGiftCard.gift_card_id)
        .filter(SaleGiftCard.sale_id == sale.id)
        .order_by(GiftCard.brand.asc(), GiftCard.id.asc())
        .all()
    )
    sale_fuel_rows = (
        db.query(SaleFuelAccount, FuelRewardAccount)
        .join(
            FuelRewardAccount,
            FuelRewardAccount.id == SaleFuelAccount.fuel_reward_account_id,
        )
        .filter(SaleFuelAccount.sale_id == sale.id)
        .order_by(FuelRewardAccount.retailer.asc(), FuelRewardAccount.id.asc())
        .all()
    )

    expected_payment_dates = [
        card.expected_payment_date
        for _, card in sale_card_rows
        if card.expected_payment_date is not None
    ] + [
        account.expected_payment_date
        for _, account in sale_fuel_rows
        if account.expected_payment_date is not None
    ]
    sale_expected_payment_date = (
        sale.expected_payment_date
        or (min(expected_payment_dates) if expected_payment_dates else None)
    )
    events = (
        db.query(SaleEvent)
        .filter(SaleEvent.sale_id == sale.id)
        .order_by(SaleEvent.created_at.desc(), SaleEvent.id.desc())
        .all()
    )
    export_access_revoked = voided_sale_export_access_revoked(db, sale, events)
    sensitive_details_revoked = sale.status == "VOIDED"

    return {
        "id": sale.id,
        "buyer_id": sale.buyer_id,
        "buyer_name": buyer.name if buyer else None,
        "sold_at": sale.sold_at,
        "expected_payout": sale.expected_payout,
        "card_payout_rate": sale.card_payout_rate,
        "fuel_rate_per_1000": sale.fuel_rate_per_1000,
        "payout_received": sale.payout_received,
        "payment_account_id": sale.payment_account_id,
        "payment_account": serialize_payment_account_summary(payment_account),
        "buyer_reference": sale.buyer_reference,
        "internal_tags": sale.internal_tags,
        "export_profile": sale.export_profile,
        "settlement_status_notes": sale.settlement_status_notes,
        "manual_payout_override_amount": sale.manual_payout_override_amount,
        "linked_external_reference_ids": sale.linked_external_reference_ids,
        "status": sale.status,
        "status_label": "VOIDED — ASSETS RETURNED"
        if sale.status == "VOIDED"
        else None,
        "export_access_revoked": export_access_revoked,
        "sensitive_details_revoked": sensitive_details_revoked,
        "exported_before_void": sale_exported_before_void(events),
        "notes": sale.notes,
        "expected_payment_date": sale_expected_payment_date,
        "created_at": sale.created_at,
        "updated_at": sale.updated_at,
        "gift_cards": [
            (
                redact_sale_card_for_voided_export(
                    serialize_sale_card(card, row, include_secret=False)
                )
                if sensitive_details_revoked
                else serialize_sale_card(card, row, include_secret=include_secret)
            )
            for row, card in sale_card_rows
        ],
        "fuel_accounts": [
            (
                {
                    **serialize_fuel_account(account, row),
                    "email": None,
                    "alt_id": None,
                    "login_password": None,
                    "barcode_image_url": None,
                    "barcode_value": None,
                    "sensitive_details_removed": True,
                }
                if sensitive_details_revoked
                else serialize_fuel_account(account, row)
            )
            for row, account in sale_fuel_rows
        ],
        "events": [
            {
                "id": event.id,
                "action": event.action,
                "affected_asset_count": event.affected_asset_count,
                "user_label": event.user_label,
                "field_name": event.field_name,
                "old_value": event.old_value,
                "new_value": event.new_value,
                "reason": event.reason,
                "notes": event.notes,
                "created_at": event.created_at,
            }
            for event in events
        ],
        "asset_count": len(sale_card_rows) + len(sale_fuel_rows),
    }


def card_export_text(cards: list[GiftCard], buyer: Buyer) -> str:
    delimiter = export_delimiter(buyer)
    template = buyer.card_export_format or DEFAULT_CARD_EXPORT_FORMAT
    include_header = not buyer.card_export_format

    if buyer.group_card_exports_by_brand and card_export_should_group_by_brand(template):
        return grouped_card_export_text(
            cards=cards,
            template=template,
            delimiter=delimiter,
        )

    return render_asset_export(
        template=template,
        rows=[card_export_values(card) for card in cards],
        delimiter=delimiter,
        include_header=include_header,
    )


def fuel_export_text(rows: list[tuple[SaleFuelAccount, FuelRewardAccount]], buyer: Buyer) -> str:
    delimiter = export_delimiter(buyer)
    template = buyer.fuel_export_format or DEFAULT_FUEL_EXPORT_FORMAT
    include_header = not buyer.fuel_export_format

    return render_asset_export(
        template=template,
        rows=[fuel_export_values(row, account) for row, account in rows],
        delimiter=delimiter,
        include_header=include_header,
    )


def sale_matches_query(db: Session, sale: Sale, query: str) -> bool:
    normalized_query = query.strip().lower()

    if not normalized_query:
        return True

    buyer = db.query(Buyer).filter(Buyer.id == sale.buyer_id).first()
    sale_card_rows = (
        db.query(SaleGiftCard, GiftCard)
        .join(GiftCard, GiftCard.id == SaleGiftCard.gift_card_id)
        .filter(SaleGiftCard.sale_id == sale.id)
        .all()
    )
    sale_fuel_rows = (
        db.query(SaleFuelAccount, FuelRewardAccount)
        .join(
            FuelRewardAccount,
            FuelRewardAccount.id == SaleFuelAccount.fuel_reward_account_id,
        )
        .filter(SaleFuelAccount.sale_id == sale.id)
        .all()
    )
    values = [
        str(sale.id),
        buyer.name if buyer else "",
        sale.notes or "",
        str(sale.expected_payout),
        str(sale.payout_received or ""),
    ]

    for _, card in sale_card_rows:
        values.extend(
            [
                card.brand,
                str(card.face_value),
                str(card.purchase_batch_id),
                ending(locked_card_number(card)) or "",
                card.notes or "",
            ]
        )

    for row, account in sale_fuel_rows:
        values.extend(
            [
                account.retailer,
                account.email or "",
                account.alt_id or "",
                str(row.points_sold),
            ]
        )

    return any(normalized_query in str(value).lower() for value in values)


@router.get("/")
def list_sales(q: str | None = None):
    db: Session = SessionLocal()

    try:
        sales = db.query(Sale).order_by(Sale.sold_at.desc(), Sale.id.desc()).all()
        if q:
            sales = [sale for sale in sales if sale_matches_query(db, sale, q)]
        return [serialize_sale(db, sale) for sale in sales]
    finally:
        db.close()


@router.get("/awaiting-payment")
def list_awaiting_payment_sales():
    db: Session = SessionLocal()

    try:
        sales = get_awaiting_payment_sales(db)
        sales.sort(
            key=lambda sale: (
                serialize_sale(db, sale)["expected_payment_date"] or "9999-12-31",
                serialize_sale(db, sale)["buyer_name"] or "",
                sale.id,
            )
        )
        return [serialize_sale(db, sale) for sale in sales]
    finally:
        db.close()


@router.get("/payment-history")
def list_payment_history():
    db: Session = SessionLocal()

    try:
        sales = (
            db.query(Sale)
            .filter(Sale.status != "VOIDED")
            .order_by(Sale.updated_at.desc(), Sale.sold_at.desc(), Sale.id.desc())
            .all()
        )
        ledger_rows = []

        for sale in sales:
            serialized_sale = serialize_sale(db, sale)
            sale_card_rows = (
                db.query(SaleGiftCard)
                .filter(SaleGiftCard.sale_id == sale.id)
                .filter(SaleGiftCard.settlement_received_at.isnot(None))
                .all()
            )
            sale_fuel_rows = (
                db.query(SaleFuelAccount)
                .filter(SaleFuelAccount.sale_id == sale.id)
                .filter(SaleFuelAccount.settlement_received_at.isnot(None))
                .all()
            )
            settled_rows = [*sale_card_rows, *sale_fuel_rows]

            if not settled_rows:
                continue

            payment_account_ids = {
                row.payment_account_id for row in settled_rows if row.payment_account_id
            }
            payment_account_id = (
                next(iter(payment_account_ids))
                if len(payment_account_ids) == 1
                else sale.payment_account_id
            )
            payment_account = (
                db.query(PaymentAccount)
                .filter(PaymentAccount.id == payment_account_id)
                .first()
                if payment_account_id is not None
                else None
            )
            amount_received = sum(
                to_decimal(row.payout_received) for row in settled_rows
            )
            expected_amount = sum(
                to_decimal(
                    row.expected_payout
                    if isinstance(row, SaleGiftCard)
                    else row.expected_value
                )
                for row in settled_rows
            )
            received_dates = [
                row.settlement_received_at
                for row in settled_rows
                if row.settlement_received_at is not None
            ]
            notes = [
                row.settlement_notes
                for row in settled_rows
                if row.settlement_notes
            ]

            ledger_rows.append(
                {
                    "id": sale.id,
                    "sale_id": sale.id,
                    "received_date": max(received_dates) if received_dates else None,
                    "buyer": serialized_sale["buyer_name"],
                    "buyer_id": sale.buyer_id,
                    "payment_account": serialize_payment_account_summary(payment_account),
                    "amount_received": amount_received,
                    "expected_amount": expected_amount,
                    "difference": amount_received - expected_amount,
                    "linked_sales": [
                        {
                            "id": sale.id,
                            "status": sale.status,
                            "asset_count": serialized_sale["asset_count"],
                        }
                    ],
                    "settlement_reference": sale.buyer_reference,
                    "settlement_notes": sale.settlement_status_notes
                    or "; ".join(notes)
                    or sale.notes,
                    "status": sale.status,
                    "status_label": serialized_sale["status_label"]
                    or status_label(sale.status),
                }
            )

        return ledger_rows
    finally:
        db.close()


@router.post("/")
def create_sale(payload: SaleCreate):
    if not payload.gift_card_ids and not payload.fuel_accounts:
        raise HTTPException(status_code=400, detail="Add at least one sale asset")

    if len(set(payload.gift_card_ids)) != len(payload.gift_card_ids):
        raise HTTPException(status_code=400, detail="Gift card IDs must be unique")

    fuel_account_ids = [
        fuel_account.fuel_reward_account_id for fuel_account in payload.fuel_accounts
    ]

    if len(set(fuel_account_ids)) != len(fuel_account_ids):
        raise HTTPException(status_code=400, detail="Fuel account IDs must be unique")

    db: Session = SessionLocal()

    try:
        buyer = get_buyer_or_404(db, payload.buyer_id)
        payment_account_id = (
            payload.payment_account_id
            if payload.payment_account_id is not None
            else buyer.default_payment_account_id
        )
        if payment_account_id is not None:
            get_payment_account_or_404(db, payment_account_id)
        sold_at = (
            payload.sold_at
            or (
                datetime.combine(payload.sold_date, datetime.min.time())
                if payload.sold_date
                else utc_now()
            )
        )

        cards = (
            db.query(GiftCard)
            .filter(GiftCard.id.in_(payload.gift_card_ids))
            .order_by(GiftCard.id.asc())
            .all()
            if payload.gift_card_ids
            else []
        )

        if len(cards) != len(payload.gift_card_ids):
            raise HTTPException(status_code=404, detail="One or more cards were not found")

        if any(card.status != "VERIFIED_AVAILABLE" for card in cards):
            raise HTTPException(status_code=400, detail="All cards must be available")

        fuel_accounts = (
            db.query(FuelRewardAccount)
            .filter(FuelRewardAccount.id.in_(fuel_account_ids))
            .order_by(FuelRewardAccount.id.asc())
            .all()
            if fuel_account_ids
            else []
        )

        if len(fuel_accounts) != len(fuel_account_ids):
            raise HTTPException(status_code=404, detail="One or more fuel accounts were not found")

        fuel_payloads_by_id = {
            fuel_payload.fuel_reward_account_id: fuel_payload
            for fuel_payload in payload.fuel_accounts
        }
        fuel_current_points_by_id = {
            account.id: fuel_account_current_points(db, account.id)
            for account in fuel_accounts
        }
        fuel_overage_points_by_id: dict[int, int] = {}

        for account in fuel_accounts:
            current_points = fuel_current_points_by_id[account.id]
            target_points = account.target_points
            fuel_payload = fuel_payloads_by_id[account.id]

            if account.status in {"SOLD", "INACTIVE"}:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "fuel_account_not_sellable",
                        "message": f"Fuel account {account.id} cannot be sold.",
                        "fuel_account_id": account.id,
                        "status": account.status,
                    },
                )

            if target_points is not None and current_points < target_points:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "below_target_fuel_account",
                        "message": (
                            f"{account.retailer} has {current_points:,} / "
                            f"{target_points:,} pts and is below target."
                        ),
                        "fuel_account_id": account.id,
                        "retailer": account.retailer,
                        "current_points": current_points,
                        "target_points": target_points,
                    },
                )

            overage_points = (
                current_points - target_points
                if target_points is not None
                else 0
            )
            fuel_overage_points_by_id[account.id] = max(overage_points, 0)

            if overage_points > 1000 and not fuel_payload.fuel_overage_override:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "fuel_overage_requires_override",
                        "message": (
                            f"{account.retailer} is {overage_points:,} points "
                            "over target. Confirm overage before selling."
                        ),
                        "fuel_account_id": account.id,
                        "retailer": account.retailer,
                        "current_points": current_points,
                        "target_points": target_points,
                        "overage_points": overage_points,
                    },
                )

        total_face_value = sum(to_decimal(card.face_value) for card in cards)
        card_payout_rate = normalize_payout_rate(
            payload.card_payout_rate,
        )
        if card_payout_rate is None:
            card_payout_rate = buyer.default_payout_rate
        if cards and card_payout_rate is None:
            card_payout_rate = Decimal("1.0000")

        has_cards = len(cards) > 0
        fuel_rate_per_1000 = (
            to_decimal(payload.fuel_rate_per_1000)
            if payload.fuel_rate_per_1000 is not None
            else None
        )
        fuel_accounts_by_id = {account.id: account for account in fuel_accounts}
        normalized_fuel_values: dict[int, Decimal | None] = {}

        for fuel_payload in payload.fuel_accounts:
            points_sold = round_down_to_thousand(fuel_payload.points_sold)

            if points_sold <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="Fuel points sold must be at least 1,000 sellable points",
                )

            if has_cards:
                normalized_fuel_values[fuel_payload.fuel_reward_account_id] = Decimal("0")
            else:
                if fuel_rate_per_1000 is None:
                    raise HTTPException(
                        status_code=400,
                        detail="Fuel rate per 1,000 points is required for standalone fuel sales",
                    )
                normalized_fuel_values[fuel_payload.fuel_reward_account_id] = quantize_money(
                    Decimal(points_sold // 1000) * fuel_rate_per_1000,
                )

            fuel_payload.points_sold = points_sold

        fuel_expected_total = sum(
            value for value in normalized_fuel_values.values() if value is not None
        )
        card_payout_total = quantize_money(total_face_value * to_decimal(card_payout_rate))
        calculated_expected_payout = quantize_money(card_payout_total + fuel_expected_total)
        allocated_total = Decimal("0")
        expected_payment_date = (
            payload.expected_payment_date
            or buyer_expected_payment_date(buyer, sold_at)
        )

        sale = Sale(
            buyer_id=buyer.id,
            sold_at=sold_at,
            expected_payout=calculated_expected_payout,
            card_payout_rate=card_payout_rate,
            fuel_rate_per_1000=None if has_cards else fuel_rate_per_1000,
            expected_payment_date=(
                datetime.combine(expected_payment_date, datetime.min.time())
                if expected_payment_date is not None
                else None
            ),
            payment_account_id=payment_account_id,
            status="ACTIVE",
            notes=payload.notes,
        )
        db.add(sale)
        db.flush()

        for index, card in enumerate(cards):
            if total_face_value <= 0:
                expected_payout = Decimal("0")
            elif index == len(cards) - 1:
                expected_payout = quantize_money(card_payout_total - allocated_total)
            else:
                expected_payout = quantize_money(
                    card_payout_total * (to_decimal(card.face_value) / total_face_value)
                )
                allocated_total += expected_payout

            db.add(
                SaleGiftCard(
                    sale_id=sale.id,
                    gift_card_id=card.id,
                    expected_payout=expected_payout,
                )
            )

            card.buyer_id = buyer.id
            card.sold_to = buyer.name
            card.sold_at = sold_at
            card.sold_date = sold_at.date()
            card.expected_payment_date = expected_payment_date
            card.expected_payout = expected_payout
            card.sale_price = expected_payout
            card.status = "SOLD_PENDING_PAYMENT"
            card.sale_notes = payload.notes
            card.updated_at = utc_now()

        for fuel_payload in payload.fuel_accounts:
            account = fuel_accounts_by_id[fuel_payload.fuel_reward_account_id]

            expected_value = normalized_fuel_values[fuel_payload.fuel_reward_account_id]
            overage_points = fuel_overage_points_by_id.get(account.id, 0)
            db.add(
                SaleFuelAccount(
                    sale_id=sale.id,
                    fuel_reward_account_id=account.id,
                    points_sold=fuel_payload.points_sold,
                    expected_value=expected_value,
                    is_full_account_sale=True,
                    fuel_overage_override=fuel_payload.fuel_overage_override,
                    overage_points=overage_points if overage_points > 0 else None,
                )
            )

            account.buyer_id = buyer.id
            account.sold_to = buyer.name
            account.sold_date = sold_at.date()
            account.expected_payment_date = expected_payment_date
            account.sale_price = expected_value
            if fuel_payload.login_password is not None:
                account.login_password = (
                    encrypt_field(fuel_payload.login_password)
                    if fuel_payload.login_password
                    else None
                )
            account.sale_notes = payload.notes
            if fuel_payload.fuel_overage_override and overage_points > 1000:
                overage_note = (
                    f"Fuel sale overage override: sold with "
                    f"{overage_points:,} points over target."
                )
                sale.notes = append_note(sale.notes, overage_note)
                account.sale_notes = append_note(account.sale_notes, overage_note)
            account.status = "SOLD"
            account.updated_at = utc_now()

        record_sale_event(
            db,
            sale,
            "created",
            affected_asset_count=len(cards) + len(fuel_accounts),
            notes=payload.notes,
        )
        db.commit()
        db.refresh(sale)
        return serialize_sale(db, sale, include_secret=True)
    finally:
        db.close()


@router.get("/{sale_id}")
def get_sale(sale_id: int):
    db: Session = SessionLocal()

    try:
        sale = db.query(Sale).filter(Sale.id == sale_id).first()

        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")

        return serialize_sale(db, sale)
    finally:
        db.close()


@router.patch("/{sale_id}")
def edit_sale(sale_id: int, payload: SaleEdit):
    db: Session = SessionLocal()

    try:
        sale = db.query(Sale).filter(Sale.id == sale_id).first()

        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")

        if sale.status == "VOIDED":
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "voided_sale_locked",
                    "message": "Voided sales are audit records and cannot be edited.",
                },
            )

        update_data = payload.model_dump(exclude_unset=True)
        reason = (payload.reason or "").strip() or None
        user_label = payload.user_label or "system"
        warning_fields = {
            "expected_payout",
            "card_payout_rate",
            "fuel_rate_per_1000",
            "sold_at",
            "sold_date",
        }
        changed_warning_fields = warning_fields.intersection(update_data.keys())

        if changed_warning_fields and not reason:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "edit_reason_required",
                    "message": (
                        "A reason is required when changing payout totals, "
                        "payout rates, fuel quantities/rates, or sale date."
                    ),
                    "fields": sorted(changed_warning_fields),
                },
            )

        edited_fields: list[str] = []

        if "buyer_id" in update_data and payload.buyer_id is not None:
            buyer = get_buyer_or_404(db, payload.buyer_id)
            if not values_match(sale.buyer_id, buyer.id):
                old_value = sale.buyer_id
                old_name = get_buyer_or_404(db, sale.buyer_id).name
                sale.buyer_id = buyer.id
                for card in (
                    db.query(GiftCard)
                    .join(SaleGiftCard, SaleGiftCard.gift_card_id == GiftCard.id)
                    .filter(SaleGiftCard.sale_id == sale.id)
                    .all()
                ):
                    card.buyer_id = buyer.id
                    card.sold_to = buyer.name
                    card.updated_at = utc_now()
                for account in (
                    db.query(FuelRewardAccount)
                    .join(
                        SaleFuelAccount,
                        SaleFuelAccount.fuel_reward_account_id
                        == FuelRewardAccount.id,
                    )
                    .filter(SaleFuelAccount.sale_id == sale.id)
                    .all()
                ):
                    account.buyer_id = buyer.id
                    account.sold_to = buyer.name
                    account.updated_at = utc_now()
                record_sale_field_change(
                    db,
                    sale,
                    "buyer_id",
                    f"{old_value} · {old_name}",
                    f"{buyer.id} · {buyer.name}",
                    reason,
                    user_label,
                )
                edited_fields.append("buyer_id")

        if "payment_account_id" in update_data:
            if payload.payment_account_id is not None:
                get_payment_account_or_404(db, payload.payment_account_id)
            if not values_match(sale.payment_account_id, payload.payment_account_id):
                old_value = sale.payment_account_id
                sale.payment_account_id = payload.payment_account_id
                record_sale_field_change(
                    db,
                    sale,
                    "payment_account_id",
                    old_value,
                    payload.payment_account_id,
                    reason,
                    user_label,
                )
                edited_fields.append("payment_account_id")

        if "expected_payment_date" in update_data:
            new_expected_payment_date = (
                datetime.combine(payload.expected_payment_date, datetime.min.time())
                if payload.expected_payment_date is not None
                else None
            )
            if not values_match(sale.expected_payment_date, new_expected_payment_date):
                old_value = sale.expected_payment_date
                sale.expected_payment_date = new_expected_payment_date
                for card in (
                    db.query(GiftCard)
                    .join(SaleGiftCard, SaleGiftCard.gift_card_id == GiftCard.id)
                    .filter(SaleGiftCard.sale_id == sale.id)
                    .all()
                ):
                    card.expected_payment_date = payload.expected_payment_date
                    card.updated_at = utc_now()
                for account in (
                    db.query(FuelRewardAccount)
                    .join(
                        SaleFuelAccount,
                        SaleFuelAccount.fuel_reward_account_id
                        == FuelRewardAccount.id,
                    )
                    .filter(SaleFuelAccount.sale_id == sale.id)
                    .all()
                ):
                    account.expected_payment_date = payload.expected_payment_date
                    account.updated_at = utc_now()
                record_sale_field_change(
                    db,
                    sale,
                    "expected_payment_date",
                    old_value,
                    new_expected_payment_date,
                    reason,
                    user_label,
                )
                edited_fields.append("expected_payment_date")

        if "expected_payout" in update_data and payload.expected_payout is not None:
            new_expected_payout = quantize_money(to_decimal(payload.expected_payout))
            if not values_match(sale.expected_payout, new_expected_payout):
                old_value = sale.expected_payout
                apply_expected_payout_change(db, sale, new_expected_payout)
                record_sale_field_change(
                    db,
                    sale,
                    "expected_payout",
                    old_value,
                    new_expected_payout,
                    reason,
                    user_label,
                    notes="Downstream asset expected payouts recalculated.",
                )
                edited_fields.append("expected_payout")

        if "card_payout_rate" in update_data:
            new_rate = normalize_payout_rate(payload.card_payout_rate)
            if not values_match(sale.card_payout_rate, new_rate):
                old_value = sale.card_payout_rate
                sale.card_payout_rate = new_rate
                record_sale_field_change(
                    db,
                    sale,
                    "card_payout_rate",
                    old_value,
                    new_rate,
                    reason,
                    user_label,
                )
                edited_fields.append("card_payout_rate")

        if "fuel_rate_per_1000" in update_data:
            new_fuel_rate = (
                quantize_money(to_decimal(payload.fuel_rate_per_1000))
                if payload.fuel_rate_per_1000 is not None
                else None
            )
            if not values_match(sale.fuel_rate_per_1000, new_fuel_rate):
                old_value = sale.fuel_rate_per_1000
                sale.fuel_rate_per_1000 = new_fuel_rate
                record_sale_field_change(
                    db,
                    sale,
                    "fuel_rate_per_1000",
                    old_value,
                    new_fuel_rate,
                    reason,
                    user_label,
                )
                edited_fields.append("fuel_rate_per_1000")

        if "sold_at" in update_data or "sold_date" in update_data:
            new_sold_at = payload.sold_at or (
                datetime.combine(payload.sold_date, datetime.min.time())
                if payload.sold_date is not None
                else sale.sold_at
            )
            if not values_match(sale.sold_at, new_sold_at):
                old_value = sale.sold_at
                sale.sold_at = new_sold_at
                for card in (
                    db.query(GiftCard)
                    .join(SaleGiftCard, SaleGiftCard.gift_card_id == GiftCard.id)
                    .filter(SaleGiftCard.sale_id == sale.id)
                    .all()
                ):
                    card.sold_at = new_sold_at
                    card.sold_date = new_sold_at.date()
                    card.updated_at = utc_now()
                for account in (
                    db.query(FuelRewardAccount)
                    .join(
                        SaleFuelAccount,
                        SaleFuelAccount.fuel_reward_account_id
                        == FuelRewardAccount.id,
                    )
                    .filter(SaleFuelAccount.sale_id == sale.id)
                    .all()
                ):
                    account.sold_date = new_sold_at.date()
                    account.updated_at = utc_now()
                record_sale_field_change(
                    db,
                    sale,
                    "sold_at",
                    old_value,
                    new_sold_at,
                    reason,
                    user_label,
                )
                edited_fields.append("sold_at")

        simple_fields = [
            "buyer_reference",
            "notes",
            "internal_tags",
            "export_profile",
            "settlement_status_notes",
            "manual_payout_override_amount",
            "linked_external_reference_ids",
        ]
        for field_name in simple_fields:
            if field_name not in update_data:
                continue
            new_value = getattr(payload, field_name)
            if field_name == "manual_payout_override_amount" and new_value is not None:
                new_value = quantize_money(to_decimal(new_value))
            old_value = getattr(sale, field_name)
            if values_match(old_value, new_value):
                continue
            setattr(sale, field_name, new_value)
            record_sale_field_change(
                db,
                sale,
                field_name,
                old_value,
                new_value,
                reason,
                user_label,
            )
            edited_fields.append(field_name)

        if edited_fields and sale_has_export_event(db, sale.id):
            record_sale_event(
                db,
                sale,
                "edit_warning_previously_exported",
                notes=(
                    "Sale was edited after export. Buyer may already possess "
                    "the previous package."
                ),
                user_label=user_label,
                reason=reason,
            )

        if edited_fields:
            sale.updated_at = utc_now()
        db.commit()
        db.refresh(sale)
        return serialize_sale(db, sale)
    finally:
        db.close()


@router.patch("/{sale_id}/settle")
def settle_sale(sale_id: int, payload: SaleSettle):
    db: Session = SessionLocal()

    try:
        sale = db.query(Sale).filter(Sale.id == sale_id).first()

        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")

        if payload.notes:
            sale.notes = (
                f"{sale.notes}\n{payload.notes}"
                if sale.notes
                else payload.notes
            )
        settlement_payment_account_id = (
            payload.payment_account_id
            if payload.payment_account_id is not None
            else sale.payment_account_id
        )
        if settlement_payment_account_id is not None:
            get_payment_account_or_404(db, settlement_payment_account_id)
            sale.payment_account_id = settlement_payment_account_id
        settled_at = payload.settlement_received_at or utc_now()

        sale_card_rows = (
            db.query(SaleGiftCard, GiftCard)
            .join(GiftCard, GiftCard.id == SaleGiftCard.gift_card_id)
            .filter(SaleGiftCard.sale_id == sale.id)
            .all()
        )
        sale_fuel_rows = (
            db.query(SaleFuelAccount, FuelRewardAccount)
            .join(
                FuelRewardAccount,
                FuelRewardAccount.id == SaleFuelAccount.fuel_reward_account_id,
            )
            .filter(SaleFuelAccount.sale_id == sale.id)
            .all()
        )

        expected_card_total = sum(
            to_decimal(row.expected_payout) for row, _ in sale_card_rows
        )
        expected_fuel_total = sum(
            to_decimal(row.expected_value) for row, _ in sale_fuel_rows
        )
        expected_sale_total = expected_card_total + expected_fuel_total
        allocated_total = Decimal("0")
        total_rows = len(sale_card_rows) + len(sale_fuel_rows)
        row_index = 0

        for row, card in sale_card_rows:
            row_index += 1
            if expected_sale_total <= 0:
                payout_received = quantize_money(
                    payload.payout_received - allocated_total
                    if row_index == total_rows
                    else payload.payout_received / Decimal(total_rows)
                )
                if row_index != total_rows:
                    allocated_total += payout_received
            elif row_index == total_rows:
                payout_received = quantize_money(
                    payload.payout_received - allocated_total,
                )
            else:
                payout_received = quantize_money(
                    payload.payout_received
                    * (to_decimal(row.expected_payout) / expected_sale_total),
                )
                allocated_total += payout_received

            row.payout_received = payout_received
            row.payment_account_id = settlement_payment_account_id
            row.settlement_received_at = settled_at
            row.adjustment_amount = quantize_money(
                payout_received - to_decimal(row.expected_payout)
            )
            row.adjustment_reason = payload.notes
            row.settlement_notes = payload.notes
            card.payout_received = payout_received
            card.settlement_payment_account_id = settlement_payment_account_id
            card.settlement_received_at = settled_at
            card.status = "SETTLED"
            card.updated_at = utc_now()

        for row, account in sale_fuel_rows:
            row_index += 1
            if expected_sale_total <= 0:
                payout_received = quantize_money(
                    payload.payout_received - allocated_total
                    if row_index == total_rows
                    else payload.payout_received / Decimal(total_rows)
                )
                if row_index != total_rows:
                    allocated_total += payout_received
            elif row_index == total_rows:
                payout_received = quantize_money(
                    payload.payout_received - allocated_total,
                )
            else:
                payout_received = quantize_money(
                    payload.payout_received
                    * (to_decimal(row.expected_value) / expected_sale_total),
                )
                allocated_total += payout_received

            row.payout_received = payout_received
            row.payment_account_id = settlement_payment_account_id
            row.settlement_received_at = settled_at
            row.adjustment_amount = quantize_money(
                payout_received - to_decimal(row.expected_value)
            )
            row.adjustment_reason = payload.notes
            row.settlement_notes = payload.notes
            account.updated_at = utc_now()

        update_sale_settlement_status(db, sale)
        record_sale_event(
            db,
            sale,
            "payment_received",
            affected_asset_count=total_rows,
            notes=payload.notes,
        )
        record_sale_event(
            db,
            sale,
            "reconciled",
            affected_asset_count=total_rows,
            notes=payload.notes,
        )
        db.commit()
        db.refresh(sale)
        return serialize_sale(db, sale)
    finally:
        db.close()


@router.patch("/{sale_id}/settle-assets")
def settle_sale_assets(sale_id: int, payload: SaleAssetSettle):
    if not payload.gift_card_ids and not payload.fuel_account_ids:
        raise HTTPException(status_code=400, detail="Select at least one sale asset")

    db: Session = SessionLocal()

    try:
        sale = db.query(Sale).filter(Sale.id == sale_id).first()

        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")

        sale_card_rows = (
            db.query(SaleGiftCard, GiftCard)
            .join(GiftCard, GiftCard.id == SaleGiftCard.gift_card_id)
            .filter(
                SaleGiftCard.sale_id == sale.id,
                SaleGiftCard.gift_card_id.in_(payload.gift_card_ids),
            )
            .order_by(SaleGiftCard.id.asc())
            .all()
            if payload.gift_card_ids
            else []
        )
        sale_fuel_rows = (
            db.query(SaleFuelAccount, FuelRewardAccount)
            .join(
                FuelRewardAccount,
                FuelRewardAccount.id == SaleFuelAccount.fuel_reward_account_id,
            )
            .filter(
                SaleFuelAccount.sale_id == sale.id,
                SaleFuelAccount.fuel_reward_account_id.in_(payload.fuel_account_ids),
            )
            .order_by(SaleFuelAccount.id.asc())
            .all()
            if payload.fuel_account_ids
            else []
        )

        if len(sale_card_rows) != len(set(payload.gift_card_ids)):
            raise HTTPException(
                status_code=404,
                detail="One or more selected gift cards are not in this sale",
            )

        if len(sale_fuel_rows) != len(set(payload.fuel_account_ids)):
            raise HTTPException(
                status_code=404,
                detail="One or more selected fuel accounts are not in this sale",
            )

        if any(row.settlement_received_at is not None for row, _ in sale_card_rows):
            raise HTTPException(status_code=400, detail="A selected gift card is already settled")

        if any(row.settlement_received_at is not None for row, _ in sale_fuel_rows):
            raise HTTPException(status_code=400, detail="A selected fuel account is already settled")

        selected_assets = [
            ("gift_card", row, card, to_decimal(row.expected_payout))
            for row, card in sale_card_rows
        ] + [
            ("fuel_account", row, account, to_decimal(row.expected_value))
            for row, account in sale_fuel_rows
        ]
        expected_total = sum(expected for _, _, _, expected in selected_assets)
        settled_at = payload.settlement_received_at or utc_now()
        allocated_total = Decimal("0")

        if payload.notes:
            sale.notes = (
                f"{sale.notes}\n{payload.notes}"
                if sale.notes
                else payload.notes
            )
        settlement_payment_account_id = (
            payload.payment_account_id
            if payload.payment_account_id is not None
            else sale.payment_account_id
        )
        if settlement_payment_account_id is not None:
            get_payment_account_or_404(db, settlement_payment_account_id)
            sale.payment_account_id = settlement_payment_account_id

        for index, (asset_type, row, asset, expected_payout) in enumerate(selected_assets):
            if expected_total <= 0:
                payout_received = quantize_money(
                    payload.payout_received - allocated_total
                    if index == len(selected_assets) - 1
                    else payload.payout_received / Decimal(len(selected_assets))
                )
                if index != len(selected_assets) - 1:
                    allocated_total += payout_received
            elif index == len(selected_assets) - 1:
                payout_received = quantize_money(payload.payout_received - allocated_total)
            else:
                payout_received = quantize_money(
                    payload.payout_received * (expected_payout / expected_total),
                )
                allocated_total += payout_received

            row.payout_received = payout_received
            row.payment_account_id = settlement_payment_account_id
            row.settlement_received_at = settled_at
            row.adjustment_amount = (
                quantize_money(payout_received - expected_payout)
                if payload.adjustment_amount is not None
                else None
            )
            row.adjustment_reason = payload.adjustment_reason
            row.settlement_notes = payload.notes

            if asset_type == "gift_card":
                asset.payout_received = payout_received
                asset.settlement_payment_account_id = settlement_payment_account_id
                asset.settlement_received_at = settled_at
                asset.status = "SETTLED"
                asset.updated_at = utc_now()
            else:
                asset.updated_at = utc_now()

        update_sale_settlement_status(db, sale)
        record_sale_event(
            db,
            sale,
            "payment_received",
            affected_asset_count=len(selected_assets),
            notes=payload.notes,
        )
        record_sale_event(
            db,
            sale,
            "reconciled",
            affected_asset_count=len(selected_assets),
            notes=payload.notes,
        )
        db.commit()
        db.refresh(sale)
        return serialize_sale(db, sale)
    finally:
        db.close()


@router.patch("/{sale_id}/void")
def void_sale(sale_id: int, payload: SaleVoid | None = None):
    db: Session = SessionLocal()

    try:
        sale = db.query(Sale).filter(Sale.id == sale_id).first()

        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")

        was_already_voided = sale.status == "VOIDED"

        sale_card_rows = (
            db.query(SaleGiftCard, GiftCard)
            .join(GiftCard, GiftCard.id == SaleGiftCard.gift_card_id)
            .filter(SaleGiftCard.sale_id == sale.id)
            .all()
        )
        sale_fuel_rows = (
            db.query(SaleFuelAccount, FuelRewardAccount)
            .join(
                FuelRewardAccount,
                FuelRewardAccount.id == SaleFuelAccount.fuel_reward_account_id,
            )
            .filter(SaleFuelAccount.sale_id == sale.id)
            .all()
        )

        for row, card in sale_card_rows:
            skip_asset_restore = was_already_voided and gift_card_has_nonvoid_sale(
                db,
                card.id,
                sale.id,
            )
            row.payout_received = None
            row.payment_account_id = None
            row.settlement_received_at = None
            row.adjustment_amount = None
            row.adjustment_reason = None
            row.settlement_notes = append_note(
                row.settlement_notes,
                "Sale voided; card restored to inventory.",
            )

            if skip_asset_restore:
                continue

            card.status = restored_gift_card_status(card)
            card.buyer_id = None
            card.sold_to = None
            card.sold_at = None
            card.sold_date = None
            card.expected_payment_date = None
            card.expected_payout = None
            card.sale_price = None
            card.sale_notes = None
            card.payout_received = None
            card.settlement_payment_account_id = None
            card.settlement_received_at = None
            card.updated_at = utc_now()

        for row, account in sale_fuel_rows:
            skip_asset_restore = was_already_voided and fuel_account_has_nonvoid_sale(
                db,
                account.id,
                sale.id,
            )
            row.payout_received = None
            row.payment_account_id = None
            row.settlement_received_at = None
            row.adjustment_amount = None
            row.adjustment_reason = None
            row.settlement_notes = append_note(
                row.settlement_notes,
                "Sale voided; fuel account restored to available state.",
            )

            if skip_asset_restore:
                continue

            account.status = "ACTIVE"
            account.buyer_id = None
            account.sold_to = None
            account.sold_date = None
            account.expected_payment_date = None
            account.sale_price = None
            account.sale_notes = None
            account.updated_at = utc_now()

        sale.status = "VOIDED"
        sale.payout_received = None
        sale.updated_at = utc_now()
        void_note = payload.notes if payload else None
        if void_note and not was_already_voided:
            sale.notes = append_note(sale.notes, f"Sale voided: {void_note}")

        if not was_already_voided:
            record_sale_event(
                db,
                sale,
                "voided",
                affected_asset_count=len(sale_card_rows) + len(sale_fuel_rows),
                notes=void_note,
            )
        db.commit()
        db.refresh(sale)

        return serialize_sale(db, sale)
    finally:
        db.close()


@router.get("/{sale_id}/export")
def get_sale_export(sale_id: int):
    db: Session = SessionLocal()

    try:
        sale = db.query(Sale).filter(Sale.id == sale_id).first()

        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")

        ensure_sale_export_access(db, sale)
        buyer = get_buyer_or_404(db, sale.buyer_id)
        cards = [
            card
            for _, card in db.query(SaleGiftCard, GiftCard)
            .join(GiftCard, GiftCard.id == SaleGiftCard.gift_card_id)
            .filter(SaleGiftCard.sale_id == sale.id)
            .order_by(GiftCard.brand.asc(), GiftCard.id.asc())
            .all()
        ]
        fuel_rows = (
            db.query(SaleFuelAccount, FuelRewardAccount)
            .join(
                FuelRewardAccount,
                FuelRewardAccount.id == SaleFuelAccount.fuel_reward_account_id,
            )
            .filter(SaleFuelAccount.sale_id == sale.id)
            .order_by(FuelRewardAccount.retailer.asc(), FuelRewardAccount.id.asc())
            .all()
        )

        record_sale_event(
            db,
            sale,
            "exported",
            affected_asset_count=len(cards) + len(fuel_rows),
            notes="Seller export generated.",
        )
        db.commit()
        return {
            "sale_id": sale.id,
            "card_export": card_export_text(cards, buyer),
            "fuel_export": fuel_export_text(fuel_rows, buyer) if fuel_rows else "",
        }
    finally:
        db.close()


@router.get("/{sale_id}/package.zip")
def download_sale_package(sale_id: int):
    db: Session = SessionLocal()

    try:
        sale = db.query(Sale).filter(Sale.id == sale_id).first()

        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found")

        ensure_sale_export_access(db, sale)
        buyer = get_buyer_or_404(db, sale.buyer_id)
        buyer_slug = clean_filename_part(buyer.name)
        sale_date = sale.sold_at.date().isoformat()
        buffer = BytesIO()
        card_rows = (
            db.query(SaleGiftCard, GiftCard)
            .join(GiftCard, GiftCard.id == SaleGiftCard.gift_card_id)
            .filter(SaleGiftCard.sale_id == sale.id)
            .all()
        )
        fuel_rows = (
            db.query(SaleFuelAccount, FuelRewardAccount)
            .join(
                FuelRewardAccount,
                FuelRewardAccount.id == SaleFuelAccount.fuel_reward_account_id,
            )
            .filter(SaleFuelAccount.sale_id == sale.id)
            .all()
        )
        package_filename = sale_package_filename(
            sale,
            buyer_slug,
            sale_date,
            len(card_rows),
            len(fuel_rows),
        )
        used_archive_names: set[str] = set()
        organization = buyer.zip_organization or "GROUP_BY_BRAND"
        root = sale_package_root(sale, buyer_slug, sale_date)
        purchase_ids = {
            card.purchase_batch_id for _, card in card_rows if card.purchase_batch_id
        }
        manifest = build_sale_package_manifest(
            sale,
            buyer,
            card_rows,
            fuel_rows,
            sale_date,
            organization,
        )

        with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
            if card_rows:
                if organization == "FLAT":
                    card_base_path = f"{root}/card_exports"
                    archive_text(
                        archive,
                        used_archive_names,
                        card_base_path,
                        "card_export",
                        f".{sale_export_extension(buyer)}",
                        card_export_text([card for _, card in card_rows], buyer),
                    )
                elif organization == "GROUP_BY_ASSET_TYPE":
                    card_base_path = f"{root}/card_exports"
                    archive_text(
                        archive,
                        used_archive_names,
                        card_base_path,
                        "card_export",
                        f".{sale_export_extension(buyer)}",
                        card_export_text([card for _, card in card_rows], buyer),
                    )
                    if buyer.requires_card_images:
                        for _, card in card_rows:
                            for image in (
                                db.query(CardImage)
                                .filter(CardImage.gift_card_id == card.id)
                                .filter(CardImage.retention_status == "active")
                                .order_by(CardImage.created_at.desc())
                                .all()
                            ):
                                path = local_upload_path(image.original_image_url)
                                if path:
                                    archive_file(
                                        archive,
                                        used_archive_names,
                                        path,
                                        f"{root}/card_exports/card_images",
                                        card_image_archive_stem(card),
                                        file_extension(image.original_image_url),
                                    )
                else:
                    for brand, brand_cards in grouped_cards_by_brand(
                        [card for _, card in card_rows]
                    ).items():
                        brand_base_path = (
                            f"{root}/card_exports/{clean_folder_part(brand)}"
                        )
                        archive_text(
                            archive,
                            used_archive_names,
                            brand_base_path,
                            "card_export",
                            f".{sale_export_extension(buyer)}",
                            card_export_text(brand_cards, buyer),
                        )
                        if buyer.requires_card_images:
                            for card in brand_cards:
                                for image in (
                                    db.query(CardImage)
                                    .filter(CardImage.gift_card_id == card.id)
                                    .filter(CardImage.retention_status == "active")
                                    .order_by(CardImage.created_at.desc())
                                    .all()
                                ):
                                    path = local_upload_path(image.original_image_url)
                                    if path:
                                        archive_file(
                                            archive,
                                            used_archive_names,
                                            path,
                                            f"{brand_base_path}/card_images",
                                            card_image_archive_stem(card),
                                            file_extension(image.original_image_url),
                                        )

            if buyer.requires_receipt_images:
                for purchase_id in sorted(purchase_ids):
                    receipts = (
                        db.query(Receipt)
                        .filter(Receipt.purchase_batch_id == purchase_id)
                        .filter(Receipt.retention_status == "active")
                        .order_by(Receipt.created_at.desc(), Receipt.id.desc())
                        .all()
                    )

                    for receipt in receipts:
                        path = local_upload_path(receipt.image_url)
                        if path:
                            archive_file(
                                archive,
                                used_archive_names,
                                path,
                                f"{root}/receipts",
                                f"purchase_{purchase_id}_receipt",
                                file_extension(receipt.image_url),
                            )

            if fuel_rows:
                archive_text(
                    archive,
                    used_archive_names,
                    f"{root}/fuel_exports",
                    "fuel_export",
                    f".{sale_export_extension(buyer)}",
                    fuel_export_text(fuel_rows, buyer),
                )
                for row, account in fuel_rows:
                    archive_text(
                        archive,
                        used_archive_names,
                        f"{root}/fuel_exports/fuel_accounts",
                        f"{clean_filename_part(account.retailer)}_{row.points_sold}",
                        ".txt",
                        fuel_account_export_text(row, account),
                    )

            archive_text(
                archive,
                used_archive_names,
                root,
                "manifest",
                ".json",
                json.dumps(manifest, default=str, indent=2, sort_keys=True),
            )

        record_sale_event(
            db,
            sale,
            "exported",
            affected_asset_count=len(card_rows) + len(fuel_rows),
            notes="Sale ZIP package downloaded.",
        )
        db.commit()
        buffer.seek(0)
        return StreamingResponse(
            buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{package_filename}"',
            },
        )
    finally:
        db.close()
