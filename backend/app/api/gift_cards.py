from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
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
        return (
            db.query(GiftCard)
            .order_by(GiftCard.created_at.desc())
            .all()
        )

    finally:
        db.close()


@router.get("/purchase/{purchase_batch_id}")
def list_gift_cards(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        return (
            db.query(GiftCard)
            .filter(GiftCard.purchase_batch_id == purchase_batch_id)
            .order_by(GiftCard.created_at.desc())
            .all()
        )

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

        return card

    finally:
        db.close()


class GiftCardVerify(BaseModel):
    card_number: str
    pin: str


class GiftCardSell(BaseModel):
    sold_to: str
    sold_date: date
    sale_price: Decimal
    sale_notes: str | None = None


class GiftCardBulkSell(BaseModel):
    gift_card_ids: list[int]
    sold_to: str
    sold_date: date
    sale_price_total: Decimal
    sale_notes: str | None = None


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    return Decimal(str(value))


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
        card.sale_price = payload.sale_price
        card.sale_notes = payload.sale_notes
        card.status = "SOLD"
        card.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(card)

        return card

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
            card.sale_price = allocated_sale_price
            card.sale_notes = payload.sale_notes
            card.status = "SOLD"
            card.updated_at = datetime.utcnow()

        db.commit()

        for card in cards:
            db.refresh(card)

        return cards

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

        card.card_number_encrypted = payload.card_number
        card.pin_encrypted = payload.pin
        card.status = "VERIFIED_AVAILABLE"

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
