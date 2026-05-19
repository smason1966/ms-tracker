from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.buyer import Buyer


router = APIRouter(prefix="/buyers", tags=["buyers"])


class BuyerCreate(BaseModel):
    name: str
    buyer_type: str | None = None
    active: bool = True
    notes: str | None = None


class BuyerUpdate(BaseModel):
    name: str | None = None
    buyer_type: str | None = None
    active: bool | None = None
    notes: str | None = None


@router.post("/")
def create_buyer(payload: BuyerCreate):
    db: Session = SessionLocal()

    try:
        buyer = Buyer(
            name=payload.name,
            buyer_type=payload.buyer_type,
            active=payload.active,
            notes=payload.notes,
        )

        db.add(buyer)
        db.commit()
        db.refresh(buyer)

        return buyer

    finally:
        db.close()


@router.patch("/{buyer_id}")
def update_buyer(buyer_id: int, payload: BuyerUpdate):
    db: Session = SessionLocal()

    try:
        buyer = (
            db.query(Buyer)
            .filter(Buyer.id == buyer_id)
            .first()
        )

        if not buyer:
            raise HTTPException(status_code=404, detail="Buyer not found")

        update_data = payload.model_dump(exclude_unset=True)

        for field, value in update_data.items():
            setattr(buyer, field, value)

        db.commit()
        db.refresh(buyer)

        return buyer

    finally:
        db.close()


@router.get("/")
def list_buyers():
    db: Session = SessionLocal()

    try:
        return db.query(Buyer).order_by(Buyer.name.asc()).all()

    finally:
        db.close()
