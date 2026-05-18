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
    notes: str | None = None


@router.post("/")
def create_gift_card(payload: GiftCardCreate):
    db: Session = SessionLocal()

    try:
        card = GiftCard(
            purchase_batch_id=payload.purchase_batch_id,
            brand=payload.brand,
            face_value=payload.face_value,
            notes=payload.notes,
        )

        db.add(card)
        db.commit()
        db.refresh(card)

        return card

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
