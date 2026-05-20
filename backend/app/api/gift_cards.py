from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.buyer import Buyer
from app.models.gift_card import GiftCard
from app.services.purchase_allocation import recalculate_purchase_allocation



router = APIRouter(prefix="/gift-cards", tags=["gift-cards"])


class GiftCardCreate(BaseModel):
    purchase_batch_id: int
    brand: str
    face_value: Decimal
    acquisition_cost: Decimal | None = None
    notes: str | None = None


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
        card = GiftCard(
            purchase_batch_id=payload.purchase_batch_id,
            brand=payload.brand,
            face_value=payload.face_value,
            acquisition_cost=payload.acquisition_cost,
            notes=payload.notes,
        )

        db.add(card)
        db.commit()
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
    internal_notes: str | None = None


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


def serialize_gift_card(card: GiftCard, db: Session | None = None) -> dict:
    acquisition_cost = to_decimal(card.acquisition_cost)
    expected_payout = to_decimal(card.expected_payout)
    payout_received = to_decimal(card.payout_received)
    receivable = Decimal("0")

    if card.status == "SOLD_PENDING_PAYMENT":
        receivable = expected_payout

    return {
        "id": card.id,
        "purchase_batch_id": card.purchase_batch_id,
        "brand": card.brand,
        "face_value": card.face_value,
        "acquisition_cost": card.acquisition_cost,
        "status": card.status,
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
        "payout_received": card.payout_received,
        "internal_notes": card.internal_notes,
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "expected_profit": expected_payout - acquisition_cost
        if card.expected_payout is not None
        else None,
        "realized_profit": payout_received - acquisition_cost
        if card.payout_received is not None
        else None,
        "outstanding_receivables": receivable,
        "inventory_aging_days": (datetime.utcnow() - card.created_at).days,
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


def ensure_buyer_exists(db: Session, buyer_id: int) -> Buyer:
    buyer = db.query(Buyer).filter(Buyer.id == buyer_id).first()

    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")

    return buyer


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
        apply_liquidation_sale(
            card,
            buyer,
            payload.expected_payout,
            sold_at,
            payload.expected_payment_date,
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
            else quantize_money(total_face_value * payload.liquidation_rate)
        )
        allocated_total = Decimal("0")
        sold_at = combine_optional_date(payload.sold_date)

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
                payload.expected_payment_date,
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
