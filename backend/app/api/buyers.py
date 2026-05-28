from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.buyer import Buyer, BuyerExternalIdentifier
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.models.payment_account import PaymentAccount
from app.models.sale import Sale


router = APIRouter(prefix="/buyers", tags=["buyers"])


class BuyerExternalIdentifierPayload(BaseModel):
    platform_source: str
    identifier: str
    notes: str | None = None


class BuyerCreate(BaseModel):
    name: str
    buyer_category: str | None = None
    buyer_type: str | None = None
    preferred_contact_method: str | None = None
    contact_handle: str | None = None
    backup_contact: str | None = None
    contact_email: str | None = None
    default_payout_days: int | None = None
    default_payout_rate: Decimal | None = Decimal("100")
    requires_card_images: bool = False
    requires_receipt_images: bool = False
    preferred_export_type: str = "TXT"
    card_export_format: str | None = None
    fuel_export_format: str | None = None
    default_payment_account_id: int | None = None
    expected_payment_reference: str | None = None
    settlement_behavior_notes: str | None = None
    payment_timing_notes: str | None = None
    payment_reference_format: str | None = None
    payment_instructions: str | None = None
    group_card_exports_by_brand: bool = True
    preserve_blank_export_columns: bool = True
    zip_organization: str = "GROUP_BY_BRAND"
    external_identifiers: list[BuyerExternalIdentifierPayload] = []
    active: bool = True
    notes: str | None = None


class BuyerUpdate(BaseModel):
    name: str | None = None
    buyer_category: str | None = None
    buyer_type: str | None = None
    preferred_contact_method: str | None = None
    contact_handle: str | None = None
    backup_contact: str | None = None
    contact_email: str | None = None
    default_payout_days: int | None = None
    default_payout_rate: Decimal | None = None
    requires_card_images: bool | None = None
    requires_receipt_images: bool | None = None
    preferred_export_type: str | None = None
    card_export_format: str | None = None
    fuel_export_format: str | None = None
    default_payment_account_id: int | None = None
    expected_payment_reference: str | None = None
    settlement_behavior_notes: str | None = None
    payment_timing_notes: str | None = None
    payment_reference_format: str | None = None
    payment_instructions: str | None = None
    group_card_exports_by_brand: bool | None = None
    preserve_blank_export_columns: bool | None = None
    zip_organization: str | None = None
    external_identifiers: list[BuyerExternalIdentifierPayload] | None = None
    active: bool | None = None
    notes: str | None = None


def normalize_payout_rate(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None
    if Decimal("0") < value < Decimal("1"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_payout_rate_format",
                "message": "Enter default payout rate as a percentage.",
            },
        )
    return (value / Decimal("100")).quantize(Decimal("0.0001"))


def serialize_payment_account(account: PaymentAccount | None) -> dict | None:
    if account is None:
        return None
    return {
        "id": account.id,
        "name": account.name,
        "account_type": account.account_type,
        "institution": account.institution,
        "last_four": account.last_four,
        "account_identifier": account.account_identifier,
        "payment_identifier": account.payment_identifier,
        "is_business_account": account.is_business_account,
        "bank_account_type": account.bank_account_type,
        "active": account.active,
    }


def serialize_external_identifier(identifier: BuyerExternalIdentifier) -> dict:
    return {
        "id": identifier.id,
        "platform_source": identifier.platform_source,
        "identifier": identifier.identifier,
        "notes": identifier.notes,
    }


def buyer_metrics(db: Session, buyer_id: int) -> dict:
    sales = db.query(Sale).filter(Sale.buyer_id == buyer_id).all()
    total_sales_volume = sum(Decimal(str(sale.expected_payout or 0)) for sale in sales)
    outstanding_payouts = sum(
        Decimal(str(sale.expected_payout or 0))
        - Decimal(str(sale.payout_received or 0))
        for sale in sales
        if sale.status != "VOIDED"
    )
    total_settled_payouts = sum(
        Decimal(str(sale.payout_received or 0))
        for sale in sales
        if sale.payout_received is not None
    )

    return {
        "total_sales_volume": total_sales_volume,
        "outstanding_payouts": outstanding_payouts,
        "total_settled_payouts": total_settled_payouts,
        "avg_payout_days": None,
    }


def serialize_buyer(db: Session, buyer: Buyer) -> dict:
    default_payment_account = (
        db.query(PaymentAccount)
        .filter(PaymentAccount.id == buyer.default_payment_account_id)
        .first()
        if buyer.default_payment_account_id is not None
        else None
    )
    external_identifiers = (
        db.query(BuyerExternalIdentifier)
        .filter(BuyerExternalIdentifier.buyer_id == buyer.id)
        .order_by(BuyerExternalIdentifier.id.asc())
        .all()
    )

    return {
        "id": buyer.id,
        "name": buyer.name,
        "buyer_category": buyer.buyer_category,
        "buyer_type": buyer.buyer_type,
        "preferred_contact_method": buyer.preferred_contact_method,
        "contact_handle": buyer.contact_handle,
        "backup_contact": buyer.backup_contact,
        "contact_email": buyer.contact_email,
        "active": buyer.active,
        "default_payout_days": buyer.default_payout_days,
        "default_payout_rate": buyer.default_payout_rate or Decimal("1.0000"),
        "requires_card_images": buyer.requires_card_images,
        "requires_receipt_images": buyer.requires_receipt_images,
        "preferred_export_type": buyer.preferred_export_type or "TXT",
        "card_export_format": buyer.card_export_format,
        "fuel_export_format": buyer.fuel_export_format,
        "default_payment_account_id": buyer.default_payment_account_id,
        "default_payment_account": serialize_payment_account(default_payment_account),
        "expected_payment_reference": buyer.expected_payment_reference,
        "settlement_behavior_notes": buyer.settlement_behavior_notes,
        "payment_timing_notes": buyer.payment_timing_notes,
        "payment_reference_format": buyer.payment_reference_format,
        "payment_instructions": buyer.payment_instructions,
        "group_card_exports_by_brand": buyer.group_card_exports_by_brand,
        "preserve_blank_export_columns": buyer.preserve_blank_export_columns,
        "zip_organization": buyer.zip_organization or "GROUP_BY_BRAND",
        "external_identifiers": [
            serialize_external_identifier(identifier)
            for identifier in external_identifiers
        ],
        "notes": buyer.notes,
        "created_at": buyer.created_at,
        **buyer_metrics(db, buyer.id),
    }


def validate_payment_account(db: Session, payment_account_id: int | None) -> None:
    if payment_account_id is None:
        return
    exists = (
        db.query(PaymentAccount.id)
        .filter(PaymentAccount.id == payment_account_id)
        .first()
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Payment account not found")


def apply_external_identifiers(
    db: Session,
    buyer_id: int,
    identifiers: list[BuyerExternalIdentifierPayload],
) -> None:
    db.query(BuyerExternalIdentifier).filter(
        BuyerExternalIdentifier.buyer_id == buyer_id
    ).delete()
    for identifier in identifiers:
        platform_source = identifier.platform_source.strip()
        identifier_value = identifier.identifier.strip()
        if not platform_source or not identifier_value:
            continue
        db.add(
            BuyerExternalIdentifier(
                buyer_id=buyer_id,
                platform_source=platform_source,
                identifier=identifier_value,
                notes=identifier.notes,
            )
        )


def buyer_payload_data(payload: BuyerCreate | BuyerUpdate) -> dict:
    data = payload.model_dump(exclude_unset=True)
    data.pop("external_identifiers", None)
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()
    if "buyer_category" in data and data["buyer_category"]:
        data["buyer_category"] = data["buyer_category"].strip()
    if "buyer_type" in data and data["buyer_type"] is None and data.get("buyer_category"):
        data["buyer_type"] = data["buyer_category"]
    if "default_payout_rate" in data:
        data["default_payout_rate"] = normalize_payout_rate(data["default_payout_rate"])
    return data


@router.post("/")
def create_buyer(payload: BuyerCreate):
    db: Session = SessionLocal()

    try:
        validate_payment_account(db, payload.default_payment_account_id)
        data = buyer_payload_data(payload)
        if not data.get("buyer_type"):
            data["buyer_type"] = data.get("buyer_category")
        if data.get("default_payout_rate") is None:
            data["default_payout_rate"] = Decimal("1.0000")
        buyer = Buyer(**data)
        db.add(buyer)
        db.flush()
        apply_external_identifiers(db, buyer.id, payload.external_identifiers)
        db.commit()
        db.refresh(buyer)
        return serialize_buyer(db, buyer)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        duplicate = (
            db.query(Buyer)
            .filter(func.lower(Buyer.name) == payload.name.strip().lower())
            .first()
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "duplicate_buyer",
                    "message": f"Buyer {payload.name.strip()} already exists.",
                    "buyer_id": duplicate.id,
                },
            ) from exc
        raise HTTPException(
            status_code=400,
            detail={"message": "Unable to save buyer", "error": str(exc)},
        ) from exc
    finally:
        db.close()


@router.patch("/{buyer_id}")
def update_buyer(buyer_id: int, payload: BuyerUpdate):
    db: Session = SessionLocal()

    try:
        buyer = db.query(Buyer).filter(Buyer.id == buyer_id).first()
        if not buyer:
            raise HTTPException(status_code=404, detail="Buyer not found")

        if "default_payment_account_id" in payload.model_fields_set:
            validate_payment_account(db, payload.default_payment_account_id)

        for field, value in buyer_payload_data(payload).items():
            setattr(buyer, field, value)

        if payload.external_identifiers is not None:
            apply_external_identifiers(db, buyer.id, payload.external_identifiers)

        db.commit()
        db.refresh(buyer)
        return serialize_buyer(db, buyer)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail={"message": "Unable to update buyer", "error": str(exc)},
        ) from exc
    finally:
        db.close()


@router.get("/")
def list_buyers():
    db: Session = SessionLocal()

    try:
        buyers = db.query(Buyer).order_by(Buyer.name.asc()).all()
        return [serialize_buyer(db, buyer) for buyer in buyers]
    finally:
        db.close()


@router.get("/{buyer_id}")
def get_buyer(buyer_id: int):
    db: Session = SessionLocal()

    try:
        buyer = db.query(Buyer).filter(Buyer.id == buyer_id).first()
        if not buyer:
            raise HTTPException(status_code=404, detail="Buyer not found")
        return serialize_buyer(db, buyer)
    finally:
        db.close()


@router.delete("/{buyer_id}")
def delete_or_deactivate_buyer(buyer_id: int):
    db: Session = SessionLocal()

    try:
        buyer = db.query(Buyer).filter(Buyer.id == buyer_id).first()
        if not buyer:
            raise HTTPException(status_code=404, detail="Buyer not found")

        related_counts = {
            "sales": db.query(Sale).filter(Sale.buyer_id == buyer_id).count(),
            "gift_cards": db.query(GiftCard)
            .filter(GiftCard.buyer_id == buyer_id)
            .count(),
            "fuel_accounts": db.query(FuelRewardAccount)
            .filter(FuelRewardAccount.buyer_id == buyer_id)
            .count(),
        }
        related_total = sum(related_counts.values())
        if related_total > 0:
            buyer.active = False
            db.commit()
            db.refresh(buyer)
            return {
                "deleted": False,
                "deactivated": True,
                "related_counts": related_counts,
                "message": "Buyer has related records and was deactivated instead of deleted.",
                "buyer": serialize_buyer(db, buyer),
            }

        db.query(BuyerExternalIdentifier).filter(
            BuyerExternalIdentifier.buyer_id == buyer_id
        ).delete()
        db.delete(buyer)
        db.commit()
        return {
            "deleted": True,
            "deactivated": False,
            "related_counts": related_counts,
            "message": "Buyer deleted.",
        }
    finally:
        db.close()
