from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.purchase_batch import PurchaseBatch


router = APIRouter(prefix="/purchase-batches", tags=["purchase-batches"])


class PurchaseBatchCreate(BaseModel):
    store_name: str
    purchase_date: datetime
    total_amount: Decimal
    notes: str | None = None


@router.post("/")
def create_purchase_batch(payload: PurchaseBatchCreate):
    db: Session = SessionLocal()

    try:
        batch = PurchaseBatch(
            store_name=payload.store_name,
            purchase_date=payload.purchase_date,
            total_amount=payload.total_amount,
            notes=payload.notes,
        )
        db.add(batch)
        db.commit()
        db.refresh(batch)
        return batch
    finally:
        db.close()


@router.get("/")
def list_purchase_batches():
    db: Session = SessionLocal()

    try:
        return db.query(PurchaseBatch).order_by(PurchaseBatch.created_at.desc()).all()
    finally:
        db.close()