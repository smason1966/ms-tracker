from decimal import Decimal

from fastapi import APIRouter
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