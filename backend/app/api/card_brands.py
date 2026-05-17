from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card_brand import CardBrand


router = APIRouter(prefix="/card-brands", tags=["card-brands"])


class CardBrandCreate(BaseModel):
    name: str
    active: bool = True


@router.post("/")
def create_card_brand(payload: CardBrandCreate):
    db: Session = SessionLocal()

    try:
        card_brand = CardBrand(
            name=payload.name,
            active=payload.active,
        )

        db.add(card_brand)
        db.commit()
        db.refresh(card_brand)

        return card_brand

    finally:
        db.close()


@router.get("/")
def list_card_brands():
    db: Session = SessionLocal()

    try:
        return db.query(CardBrand).order_by(CardBrand.name.asc()).all()

    finally:
        db.close()
