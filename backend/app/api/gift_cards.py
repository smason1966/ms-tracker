import logging
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.buyer import Buyer
from app.models.card_image import CardImage
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_candidate import ExtractionCandidate
from app.models.extraction_profile_metric import ExtractionProfileMetric
from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch
from app.models.sale import Sale
from app.models.sale_event import SaleEvent
from app.models.sale_gift_card import SaleGiftCard
from app.services.purchase_allocation import recalculate_purchase_allocation



router = APIRouter(prefix="/gift-cards", tags=["gift-cards"])
logger = logging.getLogger(__name__)


class GiftCardCreate(BaseModel):
    purchase_batch_id: int
    brand: str
    face_value: Decimal
    acquisition_cost: Decimal | None = None
    notes: str | None = None
    idempotency_key: str | None = None


class GiftCardUpdate(BaseModel):
    brand: str | None = None
    face_value: Decimal | None = None
    acquisition_cost: Decimal | None = None
    notes: str | None = None


def get_payload_fields(payload: BaseModel) -> set[str]:
    return set(
        getattr(
            payload,
            "model_fields_set",
            getattr(payload, "__fields_set__", set()),
        )
    )


@router.post("/")
def create_gift_card(payload: GiftCardCreate):
    db: Session = SessionLocal()

    try:
        idempotency_key = (
            payload.idempotency_key.strip()
            if payload.idempotency_key and payload.idempotency_key.strip()
            else None
        )
        if idempotency_key:
            existing_card = (
                db.query(GiftCard)
                .filter(GiftCard.intake_idempotency_key == idempotency_key)
                .first()
            )
            if existing_card:
                return serialize_gift_card(existing_card, db)

        card = GiftCard(
            purchase_batch_id=payload.purchase_batch_id,
            brand=payload.brand,
            face_value=payload.face_value,
            acquisition_cost=payload.acquisition_cost,
            notes=payload.notes,
            ocr_status="pending",
            intake_idempotency_key=idempotency_key,
        )

        db.add(card)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if idempotency_key:
                existing_card = (
                    db.query(GiftCard)
                    .filter(GiftCard.intake_idempotency_key == idempotency_key)
                    .first()
                )
                if existing_card:
                    return serialize_gift_card(existing_card, db)
            raise
        db.refresh(card)

        recalculate_purchase_allocation(db, payload.purchase_batch_id)
        db.commit()
        db.refresh(card)

        return card

    finally:
        db.close()


@router.get("/")
def list_all_gift_cards():
    db: Session = SessionLocal()

    try:
        cards = (
            db.query(GiftCard)
            .order_by(GiftCard.created_at.desc())
            .all()
        )
        return [serialize_gift_card(card, db) for card in cards]

    finally:
        db.close()


@router.get("/purchase/{purchase_batch_id}")
def list_gift_cards(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        cards = (
            db.query(GiftCard)
            .filter(GiftCard.purchase_batch_id == purchase_batch_id)
            .order_by(GiftCard.created_at.desc())
            .all()
        )
        return [serialize_gift_card(card, db) for card in cards]

    finally:
        db.close()


@router.get("/verification-queue")
def list_verification_queue(
    brand: str | None = None,
    purchase_batch_id: int | None = None,
    pending_only: bool = True,
):
    db: Session = SessionLocal()

    try:
        query = db.query(GiftCard)

        query = query.filter(
            ~GiftCard.status.in_(
                [
                    "SOLD",
                    "SOLD_PENDING_PAYMENT",
                    "SETTLED",
                    "REDEEMED",
                    "VOID",
                    "VOIDED",
                ]
            )
        )

        if pending_only:
            query = query.filter(GiftCard.status != "VERIFIED_AVAILABLE")

        if brand:
            query = query.filter(GiftCard.brand == brand)

        if purchase_batch_id is not None:
            query = query.filter(GiftCard.purchase_batch_id == purchase_batch_id)

        return query.order_by(GiftCard.created_at.desc()).all()

    finally:
        db.close()


@router.get("/{gift_card_id}")
def get_gift_card(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        card = (
            db.query(GiftCard)
            .filter(GiftCard.id == gift_card_id)
            .first()
        )

        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")

        return serialize_gift_card(card, db)

    finally:
        db.close()


class GiftCardVerify(BaseModel):
    card_number: str | None = None
    confirmed_card_number: str | None = None
    pin: str | None = None
    face_value: Decimal | None = None
    notes: str | None = None
    verified_balance: Decimal | None = None
    verification_notes: str | None = None
    verification_source: str | None = None
    verification_status: str | None = None


class GiftCardSell(BaseModel):
    sold_to: str
    sold_date: date
    sale_price: Decimal
    expected_payment_date: date | None = None
    sale_notes: str | None = None


class GiftCardBulkSell(BaseModel):
    gift_card_ids: list[int]
    sold_to: str
    sold_date: date
    sale_price_total: Decimal
    expected_payment_date: date | None = None
    sale_notes: str | None = None


class GiftCardLiquidationSell(BaseModel):
    buyer_id: int
    expected_payout: Decimal
    sold_at: datetime | None = None
    sold_date: date | None = None
    expected_payment_date: date | None = None
    sale_notes: str | None = None
    internal_notes: str | None = None


class GiftCardSettle(BaseModel):
    payout_received: Decimal
    settlement_received_at: datetime | None = None
    settlement_received_date: date | None = None
    payment_account_id: int | None = None
    internal_notes: str | None = None


class GiftCardVoid(BaseModel):
    void_reason: str | None = None
    notes: str | None = None
    duplicate_existing_card_id: int | None = None


class GiftCardMove(BaseModel):
    purchase_batch_id: int


class GiftCardBulkLiquidationSell(BaseModel):
    gift_card_ids: list[int]
    buyer_id: int
    payout_total: Decimal | None = None
    liquidation_rate: Decimal | None = None
    sold_date: date | None = None
    expected_payment_date: date | None = None
    sale_notes: str | None = None
    internal_notes: str | None = None


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def normalize_percentage_rate(value: Decimal) -> Decimal:
    rate = to_decimal(value)
    if Decimal("0") < rate < Decimal("1"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_payout_rate_format",
                "message": "Enter payout rate as a percentage.",
            },
        )

    return rate / Decimal("100")


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    return Decimal(str(value))


def get_buyer_name(db: Session, buyer_id: int | None) -> str | None:
    if buyer_id is None:
        return None

    buyer = db.query(Buyer).filter(Buyer.id == buyer_id).first()
    return buyer.name if buyer else None


def get_sale_history(db: Session | None, card: GiftCard) -> list[dict]:
    if db is None:
        return []

    rows = (
        db.query(SaleGiftCard, Sale, Buyer)
        .join(Sale, Sale.id == SaleGiftCard.sale_id)
        .join(Buyer, Buyer.id == Sale.buyer_id)
        .filter(SaleGiftCard.gift_card_id == card.id)
        .order_by(Sale.sold_at.desc(), Sale.id.desc())
        .all()
    )

    return [
        {
            "sale_id": sale.id,
            "buyer_id": buyer.id,
            "buyer_name": buyer.name,
            "sold_at": sale.sold_at,
            "expected_payout": row.expected_payout,
            "payout_received": sale.payout_received,
            "status": sale.status,
            "notes": sale.notes,
        }
        for row, sale, buyer in rows
    ]


def serialize_gift_card(card: GiftCard, db: Session | None = None) -> dict:
    acquisition_cost = to_decimal(card.acquisition_cost)
    expected_payout = to_decimal(card.expected_payout)
    payout_received = to_decimal(card.payout_received)
    receivable = Decimal("0")
    extraction_candidate_count = 0
    rejected_extraction_candidate_count = 0

    if card.status == "SOLD_PENDING_PAYMENT":
        receivable = expected_payout

    if db is not None:
        extraction_candidate_count = (
            db.query(ExtractionCandidate)
            .filter(
                ExtractionCandidate.gift_card_id == card.id,
                ExtractionCandidate.candidate_type != "rejected",
            )
            .count()
        )
        rejected_extraction_candidate_count = (
            db.query(ExtractionCandidate)
            .filter(
                ExtractionCandidate.gift_card_id == card.id,
                ExtractionCandidate.candidate_type == "rejected",
            )
            .count()
        )

    return {
        "id": card.id,
        "purchase_batch_id": card.purchase_batch_id,
        "brand": card.brand,
        "face_value": card.face_value,
        "acquisition_cost": card.acquisition_cost,
        "status": card.status,
        "ocr_status": card.ocr_status,
        "extraction_candidate_count": extraction_candidate_count,
        "rejected_extraction_candidate_count": rejected_extraction_candidate_count,
        "card_number_encrypted": card.card_number_encrypted,
        "pin_encrypted": card.pin_encrypted,
        "notes": card.notes,
        "sold_to": card.sold_to,
        "sold_date": card.sold_date,
        "sale_price": card.sale_price,
        "sale_notes": card.sale_notes,
        "asking_price": card.asking_price,
        "expected_payout": card.expected_payout,
        "liquidation_rate": card.liquidation_rate,
        "buyer_id": card.buyer_id,
        "buyer_name": get_buyer_name(db, card.buyer_id) if db else None,
        "reserved_at": card.reserved_at,
        "sold_at": card.sold_at,
        "expected_payment_date": card.expected_payment_date,
        "settlement_received_at": card.settlement_received_at,
        "settlement_payment_account_id": card.settlement_payment_account_id,
        "payout_received": card.payout_received,
        "internal_notes": card.internal_notes,
        "void_reason": card.void_reason,
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "intake_idempotency_key": card.intake_idempotency_key,
        "expected_profit": expected_payout - acquisition_cost
        if card.expected_payout is not None
        else None,
        "realized_profit": payout_received - acquisition_cost
        if card.payout_received is not None
        else None,
        "outstanding_receivables": receivable,
        "inventory_aging_days": (datetime.utcnow() - card.created_at).days,
        "sale_history": get_sale_history(db, card),
    }


def normalize_verification_status(value: str | None) -> str | None:
    if value is None:
        return None

    normalized_value = value.strip().upper()
    allowed_statuses = {"PENDING", "VERIFIED", "ISSUE"}

    if normalized_value not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="verification_status must be PENDING, VERIFIED, or ISSUE",
        )

    return normalized_value


def get_gift_card_or_404(db: Session, gift_card_id: int) -> GiftCard:
    card = db.query(GiftCard).filter(GiftCard.id == gift_card_id).first()

    if not card:
        raise HTTPException(status_code=404, detail="Gift card not found")

    return card


def gift_card_lifecycle_state(card: GiftCard, linked_sales: list[dict]) -> str:
    status = (card.status or "").upper()

    if status == "VOIDED":
        return "voided"
    if status == "ARCHIVED":
        return "archived"
    if status in {"DELETED_SOFT", "SOFT_DELETED"}:
        return "deleted_soft"
    if (
        status in {"SOLD", "SOLD_PENDING_PAYMENT", "SETTLED"}
        and linked_sales
        and all(sale["status"] == "VOIDED" for sale in linked_sales)
    ):
        return "stale_sale_state"
    if any(sale["exported"] and sale["status"] != "VOIDED" for sale in linked_sales):
        return "exported"
    if status in {"SETTLED"}:
        return "settled"
    if status in {"SOLD", "SOLD_PENDING_PAYMENT"}:
        return "sold"
    if status == "VERIFIED_AVAILABLE":
        return "verified_available"
    if status == "NEEDS_VERIFICATION":
        return "intake_pending"

    return status.lower() or "unknown"


def gift_card_cleanup_report(db: Session, card: GiftCard) -> dict:
    sale_rows = (
        db.query(SaleGiftCard, Sale)
        .join(Sale, Sale.id == SaleGiftCard.sale_id)
        .filter(SaleGiftCard.gift_card_id == card.id)
        .order_by(Sale.id.desc())
        .all()
    )
    exported_sale_ids = {
        sale_id
        for (sale_id,) in db.query(SaleEvent.sale_id)
        .filter(SaleEvent.sale_id.in_([sale.id for _, sale in sale_rows] or [-1]))
        .filter(SaleEvent.action == "exported")
        .all()
    }

    linked_sales: list[dict] = []
    blocking_dependencies: list[dict] = []
    warnings: list[str] = []

    for sale_link, sale in sale_rows:
        sale_status = (sale.status or "").upper()
        exported = sale.id in exported_sale_ids
        settled = bool(sale_link.settlement_received_at or sale_link.payout_received)
        sale_info = {
            "sale_id": sale.id,
            "sale_link_id": sale_link.id,
            "status": sale_status,
            "expected_payout": str(sale_link.expected_payout)
            if sale_link.expected_payout is not None
            else None,
            "payout_received": str(sale_link.payout_received)
            if sale_link.payout_received is not None
            else None,
            "settlement_received_at": sale_link.settlement_received_at,
            "exported": exported,
            "blocking": False,
        }

        if sale_status == "VOIDED":
            warnings.append(
                f"Voided Sale #{sale.id} link will be removed during hard delete."
            )
        elif settled or sale_status in {"SETTLED", "COMPLETED"}:
            sale_info["blocking"] = True
            blocking_dependencies.append(
                {
                    "type": "settled_sale",
                    "sale_id": sale.id,
                    "message": f"Cannot delete because card belongs to settled Sale #{sale.id}.",
                }
            )
        elif exported:
            sale_info["blocking"] = True
            blocking_dependencies.append(
                {
                    "type": "exported_sale",
                    "sale_id": sale.id,
                    "message": f"Cannot delete because card was exported in Sale #{sale.id}.",
                }
            )
        else:
            sale_info["blocking"] = True
            blocking_dependencies.append(
                {
                    "type": "active_sale",
                    "sale_id": sale.id,
                    "message": f"Cannot delete because card belongs to active Sale #{sale.id}.",
                }
            )

        linked_sales.append(sale_info)

    status = (card.status or "").upper()
    if status in {"SOLD", "SOLD_PENDING_PAYMENT", "SETTLED"} and not linked_sales:
        blocking_dependencies.append(
            {
                "type": "sold_status",
                "message": (
                    "Cannot delete because card status is "
                    f"{status}. Clear sale/payment state before hard delete."
                ),
            }
        )
    elif status in {"SOLD", "SOLD_PENDING_PAYMENT", "SETTLED"} and not blocking_dependencies:
        warnings.append(
            f"Card has stale {status} status but only nonblocking/voided sale links."
        )

    purchase = (
        db.query(PurchaseBatch)
        .filter(PurchaseBatch.id == card.purchase_batch_id)
        .first()
    )
    extraction_attempt_count = (
        db.query(ExtractionAttempt)
        .filter(ExtractionAttempt.gift_card_id == card.id)
        .count()
    )
    extraction_candidate_count = (
        db.query(ExtractionCandidate)
        .filter(ExtractionCandidate.gift_card_id == card.id)
        .count()
    )
    extraction_profile_metric_count = (
        db.query(ExtractionProfileMetric)
        .filter(ExtractionProfileMetric.gift_card_id == card.id)
        .count()
    )
    card_image_count = (
        db.query(CardImage)
        .filter(CardImage.gift_card_id == card.id)
        .count()
    )

    lifecycle_state = gift_card_lifecycle_state(card, linked_sales)
    can_hard_delete = not blocking_dependencies

    return {
        "gift_card_id": card.id,
        "brand": card.brand,
        "status": card.status,
        "lifecycle_state": lifecycle_state,
        "can_hard_delete": can_hard_delete,
        "can_void": status not in {"SOLD", "SOLD_PENDING_PAYMENT", "SETTLED"},
        "blocking_dependencies": blocking_dependencies,
        "warnings": warnings,
        "linked_purchase": {
            "purchase_id": purchase.id,
            "store_name": purchase.store_name,
            "purchase_date": purchase.purchase_date,
            "total_paid": str(purchase.purchase_total_paid or purchase.total_amount),
        }
        if purchase
        else None,
        "linked_sales": linked_sales,
        "ocr_assets": {
            "extraction_attempts": extraction_attempt_count,
            "extraction_candidates": extraction_candidate_count,
            "extraction_profile_metrics": extraction_profile_metric_count,
        },
        "image_references": {
            "card_images": card_image_count,
        },
    }


def cleanup_blocked_response(report: dict) -> HTTPException:
    first_blocker = (
        report["blocking_dependencies"][0]["message"]
        if report["blocking_dependencies"]
        else "Gift card cannot be deleted."
    )
    return HTTPException(
        status_code=409,
        detail={
            "error": "gift_card_delete_blocked",
            "message": first_blocker,
            "cleanup_report": report,
        },
    )


def normalize_card_number(value: str | None) -> str | None:
    if value is None:
        return None

    normalized_value = value.strip()
    return normalized_value or None


def find_duplicate_card_number(
    db: Session,
    card: GiftCard,
    card_number: str,
) -> GiftCard | None:
    return (
        db.query(GiftCard)
        .filter(GiftCard.id != card.id)
        .filter(GiftCard.brand == card.brand)
        .filter(
            or_(
                func.trim(GiftCard.card_number_encrypted) == card_number,
                func.trim(GiftCard.detected_card_number) == card_number,
            )
        )
        .order_by(GiftCard.id.asc())
        .first()
    )


def duplicate_card_number_payload(duplicate_card: GiftCard) -> dict:
    duplicate_number = (
        normalize_card_number(duplicate_card.card_number_encrypted)
        or normalize_card_number(duplicate_card.detected_card_number)
        or ""
    )

    return {
        "error": "duplicate_card_number",
        "message": (
            "Duplicate card number already exists on card "
            f"#{duplicate_card.id} / purchase "
            f"#{duplicate_card.purchase_batch_id}."
        ),
        "existing_card_id": duplicate_card.id,
        "existing_purchase_id": duplicate_card.purchase_batch_id,
        "existing_status": duplicate_card.status,
        "existing_brand": duplicate_card.brand,
        "existing_face_value": str(duplicate_card.face_value),
        "existing_card_ending": duplicate_number[-4:] if duplicate_number else None,
    }


def ensure_unique_card_number(
    db: Session,
    card: GiftCard,
    card_number: str | None,
) -> None:
    normalized_card_number = normalize_card_number(card_number)

    if normalized_card_number is None:
        return

    duplicate_card = find_duplicate_card_number(db, card, normalized_card_number)

    if duplicate_card:
        raise HTTPException(
            status_code=409,
            detail=duplicate_card_number_payload(duplicate_card),
        )


def ensure_buyer_exists(db: Session, buyer_id: int) -> Buyer:
    buyer = db.query(Buyer).filter(Buyer.id == buyer_id).first()

    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")

    return buyer


def default_expected_payment_date(
    buyer: Buyer,
    sold_date: date | None,
    expected_payment_date: date | None,
) -> date | None:
    if expected_payment_date is not None:
        return expected_payment_date

    if sold_date is None or buyer.default_payout_days is None:
        return None

    return sold_date + timedelta(days=buyer.default_payout_days)


def apply_liquidation_sale(
    card: GiftCard,
    buyer: Buyer,
    expected_payout: Decimal,
    sold_at: datetime | None,
    expected_payment_date: date | None,
    sale_notes: str | None,
    internal_notes: str | None,
) -> None:
    card.buyer_id = buyer.id
    card.sold_to = buyer.name
    card.expected_payout = expected_payout
    card.sale_price = expected_payout
    card.sold_at = sold_at or datetime.utcnow()
    card.sold_date = card.sold_at.date()
    card.expected_payment_date = expected_payment_date
    card.sale_notes = sale_notes
    card.internal_notes = internal_notes
    card.status = "SOLD_PENDING_PAYMENT"
    card.updated_at = datetime.utcnow()

    face_value = to_decimal(card.face_value)
    if face_value > 0:
        card.liquidation_rate = expected_payout / face_value


def combine_optional_date(value: date | None) -> datetime | None:
    if value is None:
        return None

    return datetime.combine(value, datetime.min.time())


@router.patch("/{gift_card_id}/sell")
def sell_gift_card(gift_card_id: int, payload: GiftCardSell):
    db: Session = SessionLocal()

    try:
        card = (
            db.query(GiftCard)
            .filter(GiftCard.id == gift_card_id)
            .first()
        )

        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")

        card.sold_to = payload.sold_to
        card.sold_date = payload.sold_date
        card.expected_payout = payload.sale_price
        card.sale_price = payload.sale_price
        card.expected_payment_date = payload.expected_payment_date
        card.sale_notes = payload.sale_notes
        card.sold_at = datetime.combine(payload.sold_date, datetime.min.time())
        card.status = "SOLD_PENDING_PAYMENT"
        card.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(card)

        return serialize_gift_card(card, db)

    finally:
        db.close()


@router.post("/{gift_card_id}/sell")
def sell_gift_card_liquidation(
    gift_card_id: int,
    payload: GiftCardLiquidationSell,
):
    db: Session = SessionLocal()

    try:
        card = get_gift_card_or_404(db, gift_card_id)

        if card.status != "VERIFIED_AVAILABLE":
            raise HTTPException(
                status_code=400,
                detail="Only available cards can be sold",
            )

        buyer = ensure_buyer_exists(db, payload.buyer_id)
        sold_at = payload.sold_at or combine_optional_date(payload.sold_date)
        sold_date = sold_at.date() if sold_at else None
        apply_liquidation_sale(
            card,
            buyer,
            payload.expected_payout,
            sold_at,
            default_expected_payment_date(
                buyer,
                sold_date,
                payload.expected_payment_date,
            ),
            payload.sale_notes,
            payload.internal_notes,
        )

        db.commit()
        db.refresh(card)
        return serialize_gift_card(card, db)
    finally:
        db.close()


@router.post("/{gift_card_id}/settle")
def settle_gift_card(gift_card_id: int, payload: GiftCardSettle):
    db: Session = SessionLocal()

    try:
        card = get_gift_card_or_404(db, gift_card_id)

        if card.status not in {"SOLD_PENDING_PAYMENT", "SOLD"}:
            raise HTTPException(
                status_code=400,
                detail="Only sold cards can be settled",
            )

        card.payout_received = payload.payout_received
        card.settlement_payment_account_id = payload.payment_account_id
        card.settlement_received_at = (
            payload.settlement_received_at
            or combine_optional_date(payload.settlement_received_date)
            or datetime.utcnow()
        )
        card.status = "SETTLED"
        card.updated_at = datetime.utcnow()

        if payload.internal_notes is not None:
            card.internal_notes = payload.internal_notes

        db.commit()
        db.refresh(card)
        return serialize_gift_card(card, db)
    finally:
        db.close()


@router.patch("/bulk-sell")
def bulk_sell_gift_cards(payload: GiftCardBulkSell):
    if not payload.gift_card_ids:
        raise HTTPException(status_code=400, detail="No gift cards selected")

    if not payload.sold_to.strip():
        raise HTTPException(status_code=400, detail="sold_to is required")

    if len(set(payload.gift_card_ids)) != len(payload.gift_card_ids):
        raise HTTPException(
            status_code=400,
            detail="Gift card IDs must be unique",
        )

    db: Session = SessionLocal()

    try:
        cards = (
            db.query(GiftCard)
            .filter(GiftCard.id.in_(payload.gift_card_ids))
            .order_by(GiftCard.id.asc())
            .all()
        )

        if len(cards) != len(payload.gift_card_ids):
            raise HTTPException(
                status_code=404,
                detail="One or more gift cards were not found",
            )

        unavailable_cards = [
            card.id
            for card in cards
            if card.status != "VERIFIED_AVAILABLE"
        ]

        if unavailable_cards:
            raise HTTPException(
                status_code=400,
                detail="All selected gift cards must be verified available",
            )

        total_face_value = sum(to_decimal(card.face_value) for card in cards)

        if total_face_value <= 0:
            raise HTTPException(
                status_code=400,
                detail="Selected gift cards must have positive face value",
            )

        allocated_sale_total = Decimal("0")

        for index, card in enumerate(cards):
            if index == len(cards) - 1:
                allocated_sale_price = quantize_money(
                    payload.sale_price_total - allocated_sale_total,
                )
            else:
                ratio = to_decimal(card.face_value) / total_face_value
                allocated_sale_price = quantize_money(
                    payload.sale_price_total * ratio,
                )
                allocated_sale_total += allocated_sale_price

            card.sold_to = payload.sold_to
            card.sold_date = payload.sold_date
            card.expected_payout = allocated_sale_price
            card.sale_price = allocated_sale_price
            card.expected_payment_date = payload.expected_payment_date
            card.sale_notes = payload.sale_notes
            card.sold_at = datetime.combine(payload.sold_date, datetime.min.time())
            card.status = "SOLD_PENDING_PAYMENT"
            card.updated_at = datetime.utcnow()

        db.commit()

        for card in cards:
            db.refresh(card)

        return cards

    finally:
        db.close()


@router.post("/bulk-sell")
def bulk_sell_gift_cards_liquidation(payload: GiftCardBulkLiquidationSell):
    if not payload.gift_card_ids:
        raise HTTPException(status_code=400, detail="No gift cards selected")

    if payload.payout_total is None and payload.liquidation_rate is None:
        raise HTTPException(
            status_code=400,
            detail="payout_total or liquidation_rate is required",
        )

    db: Session = SessionLocal()

    try:
        buyer = ensure_buyer_exists(db, payload.buyer_id)
        cards = (
            db.query(GiftCard)
            .filter(GiftCard.id.in_(payload.gift_card_ids))
            .order_by(GiftCard.id.asc())
            .all()
        )

        if len(cards) != len(payload.gift_card_ids):
            raise HTTPException(
                status_code=404,
                detail="One or more gift cards were not found",
            )

        if any(card.status != "VERIFIED_AVAILABLE" for card in cards):
            raise HTTPException(
                status_code=400,
                detail="All selected cards must be available",
            )

        total_face_value = sum(to_decimal(card.face_value) for card in cards)

        if total_face_value <= 0:
            raise HTTPException(
                status_code=400,
                detail="Selected gift cards must have positive face value",
            )

        payout_total = (
            payload.payout_total
            if payload.payout_total is not None
            else quantize_money(
                total_face_value * normalize_percentage_rate(payload.liquidation_rate)
            )
        )
        allocated_total = Decimal("0")
        sold_at = combine_optional_date(payload.sold_date)
        sold_date = sold_at.date() if sold_at else date.today()
        expected_payment_date = default_expected_payment_date(
            buyer,
            sold_date,
            payload.expected_payment_date,
        )

        for index, card in enumerate(cards):
            if index == len(cards) - 1:
                expected_payout = quantize_money(payout_total - allocated_total)
            else:
                expected_payout = quantize_money(
                    payout_total * (to_decimal(card.face_value) / total_face_value)
                )
                allocated_total += expected_payout

            apply_liquidation_sale(
                card,
                buyer,
                expected_payout,
                sold_at,
                expected_payment_date,
                payload.sale_notes,
                payload.internal_notes,
            )

        db.commit()
        return [serialize_gift_card(card, db) for card in cards]
    finally:
        db.close()


@router.patch("/{gift_card_id}/redeem")
def redeem_gift_card(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        card = (
            db.query(GiftCard)
            .filter(GiftCard.id == gift_card_id)
            .first()
        )

        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")

        card.status = "REDEEMED"
        card.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(card)

        return card

    finally:
        db.close()


@router.get("/{gift_card_id}/cleanup-report")
def get_gift_card_cleanup_report(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        card = get_gift_card_or_404(db, gift_card_id)
        return gift_card_cleanup_report(db, card)
    finally:
        db.close()


@router.patch("/{gift_card_id}/void")
def void_gift_card(gift_card_id: int, payload: GiftCardVoid | None = None):
    db: Session = SessionLocal()

    try:
        card = get_gift_card_or_404(db, gift_card_id)

        if card.status in {"SOLD_PENDING_PAYMENT", "SETTLED", "SOLD"}:
            raise HTTPException(
                status_code=400,
                detail="Sold or settled cards must be archived through sale history.",
            )

        duplicate_card = None
        if payload and payload.duplicate_existing_card_id is not None:
            duplicate_card = get_gift_card_or_404(
                db,
                payload.duplicate_existing_card_id,
            )

        card.status = "VOIDED"
        card.void_reason = payload.void_reason if payload else None
        if payload and payload.notes is not None:
            card.notes = payload.notes

        if duplicate_card is not None:
            reference_note = (
                "Voided as duplicate of card "
                f"#{duplicate_card.id} / purchase "
                f"#{duplicate_card.purchase_batch_id}."
            )
            card.notes = (
                f"{card.notes}\n{reference_note}" if card.notes else reference_note
            )

        card.updated_at = datetime.utcnow()
        db.flush()
        recalculate_purchase_allocation(db, card.purchase_batch_id)
        db.commit()
        db.refresh(card)
        return serialize_gift_card(card, db)
    finally:
        db.close()


@router.delete("/{gift_card_id}")
def delete_gift_card(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        card = get_gift_card_or_404(db, gift_card_id)
        cleanup_report = gift_card_cleanup_report(db, card)

        if not cleanup_report["can_hard_delete"]:
            raise cleanup_blocked_response(cleanup_report)

        extraction_attempt_ids = [
            attempt_id
            for (attempt_id,) in db.query(ExtractionAttempt.id)
            .filter(ExtractionAttempt.gift_card_id == gift_card_id)
            .all()
        ]

        db.query(ExtractionCandidate).filter(
            ExtractionCandidate.gift_card_id == gift_card_id
        ).delete(synchronize_session=False)

        if extraction_attempt_ids:
            db.query(ExtractionCandidate).filter(
                ExtractionCandidate.extraction_attempt_id.in_(extraction_attempt_ids)
            ).delete(synchronize_session=False)

            db.query(ExtractionProfileMetric).filter(
                ExtractionProfileMetric.extraction_attempt_id.in_(
                    extraction_attempt_ids
                )
            ).delete(synchronize_session=False)

        db.query(ExtractionProfileMetric).filter(
            ExtractionProfileMetric.gift_card_id == gift_card_id
        ).delete(synchronize_session=False)
        db.query(ExtractionAttempt).filter(
            ExtractionAttempt.gift_card_id == gift_card_id
        ).delete(synchronize_session=False)
        db.query(CardImage).filter(CardImage.gift_card_id == gift_card_id).delete(
            synchronize_session=False
        )
        db.query(SaleGiftCard).filter(SaleGiftCard.gift_card_id == gift_card_id).delete(
            synchronize_session=False
        )
        purchase_batch_id = card.purchase_batch_id
        db.delete(card)
        db.flush()
        recalculate_purchase_allocation(db, purchase_batch_id)
        db.commit()

        return {
            "deleted": True,
            "gift_card_id": gift_card_id,
            "message": "Gift card and related unsold intake records deleted.",
        }
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        logger.exception(
            "Gift card hard delete blocked by database integrity dependency",
            extra={"gift_card_id": gift_card_id},
        )
        raise HTTPException(
            status_code=409,
            detail={
                "error": "gift_card_delete_integrity_dependency",
                "message": (
                    "Cannot delete: a related cleanup dependency still exists. "
                    "Review backend logs for the database constraint name."
                ),
                "gift_card_id": gift_card_id,
                "developer_detail": str(getattr(exc, "orig", exc)),
            },
        )
    except Exception:
        db.rollback()
        logger.exception("Gift card hard delete failed", extra={"gift_card_id": gift_card_id})
        raise HTTPException(
            status_code=500,
            detail={
                "error": "gift_card_delete_failed",
                "message": (
                    "Gift card cleanup failed unexpectedly. "
                    "Check backend logs for the exact cleanup step."
                ),
                "gift_card_id": gift_card_id,
            },
        )
    finally:
        db.close()


@router.patch("/{gift_card_id}/move")
def move_gift_card(gift_card_id: int, payload: GiftCardMove):
    db: Session = SessionLocal()

    try:
        card = get_gift_card_or_404(db, gift_card_id)
        target_purchase = (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == payload.purchase_batch_id)
            .first()
        )

        if not target_purchase:
            raise HTTPException(status_code=404, detail="Target purchase not found")

        if card.purchase_batch_id == target_purchase.id:
            raise HTTPException(
                status_code=400,
                detail="Gift card is already attached to that purchase.",
            )

        if card.status in {"SOLD", "SOLD_PENDING_PAYMENT", "SETTLED"}:
            raise HTTPException(
                status_code=400,
                detail="Sold or settled gift cards cannot be moved.",
            )

        sale_link = (
            db.query(SaleGiftCard)
            .filter(SaleGiftCard.gift_card_id == gift_card_id)
            .first()
        )

        if sale_link:
            raise HTTPException(
                status_code=400,
                detail="Gift card has sale history and cannot be moved.",
            )

        source_purchase_id = card.purchase_batch_id
        card.purchase_batch_id = target_purchase.id
        card.updated_at = datetime.utcnow()
        db.flush()
        recalculate_purchase_allocation(db, source_purchase_id)
        recalculate_purchase_allocation(db, target_purchase.id)
        db.commit()
        db.refresh(card)
        return {
            "moved": True,
            "source_purchase_batch_id": source_purchase_id,
            "target_purchase_batch_id": target_purchase.id,
            "gift_card": serialize_gift_card(card, db),
        }
    finally:
        db.close()


@router.patch("/{gift_card_id}/verify")
def verify_gift_card(gift_card_id: int, payload: GiftCardVerify):
    db: Session = SessionLocal()

    try:
        card = (
            db.query(GiftCard)
            .filter(GiftCard.id == gift_card_id)
            .first()
        )

        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")

        if card.status in {"SOLD", "SOLD_PENDING_PAYMENT", "SETTLED"}:
            raise HTTPException(
                status_code=400,
                detail="Sold cards cannot be verified",
            )

        confirmed_card_number = payload.confirmed_card_number

        if confirmed_card_number is None:
            confirmed_card_number = payload.card_number

        if confirmed_card_number is not None:
            confirmed_card_number = confirmed_card_number.strip()
            duplicate_card = find_duplicate_card_number(
                db,
                card,
                confirmed_card_number,
            )
            if duplicate_card:
                return JSONResponse(
                    status_code=409,
                    content=duplicate_card_number_payload(duplicate_card),
                )
            card.card_number_encrypted = confirmed_card_number

        has_confirmed_card_number = bool(
            confirmed_card_number
            and confirmed_card_number.strip()
            or card.card_number_encrypted
            and card.card_number_encrypted.strip()
        )

        if not has_confirmed_card_number:
            raise HTTPException(
                status_code=400,
                detail="Confirmed card number is required before verification",
            )

        if payload.pin is not None:
            card.pin_encrypted = payload.pin

        if payload.verified_balance is not None:
            card.verified_balance = payload.verified_balance

        if payload.face_value is not None:
            card.face_value = payload.face_value
            recalculate_purchase_allocation(db, card.purchase_batch_id)

        if payload.notes is not None:
            card.notes = payload.notes

        if payload.verification_notes is not None:
            card.verification_notes = payload.verification_notes

        if payload.verification_source is not None:
            card.verification_source = payload.verification_source

        card.verification_status = "VERIFIED"
        card.verified_at = datetime.utcnow()
        card.status = "VERIFIED_AVAILABLE"

        card.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(card)

        return card

    finally:
        db.close()


@router.patch("/{gift_card_id}")
def update_gift_card(gift_card_id: int, payload: GiftCardUpdate):
    db: Session = SessionLocal()

    try:
        card = (
            db.query(GiftCard)
            .filter(GiftCard.id == gift_card_id)
            .first()
        )

        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")

        payload_fields = get_payload_fields(payload)

        for field in payload_fields:
            setattr(card, field, getattr(payload, field))

        card.updated_at = datetime.utcnow()

        if "face_value" in payload_fields:
            recalculate_purchase_allocation(db, card.purchase_batch_id)

        db.commit()
        db.refresh(card)

        return card

    finally:
        db.close()
