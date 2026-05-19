from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.gift_card import GiftCard



router = APIRouter(prefix="/gift-cards", tags=["gift-cards"])


class GiftCardCreate(BaseModel):
    purchase_batch_id: int
    brand: str
    face_value: Decimal
    acquisition_cost: Decimal | None = None
    notes: str | None = None


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
