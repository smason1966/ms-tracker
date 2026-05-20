from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.credit_card import CreditCard
from app.models.purchase_batch import PurchaseBatch
from app.api.purchase_payments import PurchasePaymentCreate, create_purchase_payment
from app.services.purchase_allocation import recalculate_purchase_allocation


router = APIRouter(prefix="/purchase-batches", tags=["purchase-batches"])


class PurchaseBatchCreate(BaseModel):
    store_name: str
    purchase_date: datetime
    total_amount: Decimal
    purchase_total_paid: Decimal | None = None
    sales_tax: Decimal | None = None
    activation_fees: Decimal | None = None
    discounts: Decimal | None = None
    fuel_point_estimated_value: Decimal | None = None
    fuel_points_quantity: int | None = None
    fuel_points_unit: int | None = None
    fuel_points_notes: str | None = None
    financial_notes: str | None = None
    notes: str | None = None
    credit_card_id: int | None = None


class PurchaseBatchUpdate(BaseModel):
    purchase_total_paid: Decimal | None = None
    sales_tax: Decimal | None = None
    activation_fees: Decimal | None = None
    discounts: Decimal | None = None
    fuel_point_estimated_value: Decimal | None = None
    fuel_points_quantity: int | None = None
    fuel_points_unit: int | None = None
    fuel_points_notes: str | None = None
    financial_notes: str | None = None
    notes: str | None = None
    credit_card_id: int | None = None


def get_payload_fields(payload: BaseModel) -> set[str]:
    return set(
        getattr(
            payload,
            "model_fields_set",
            getattr(payload, "__fields_set__", set()),
        )
    )


def apply_credit_card_purchase_delta(
    db: Session,
    credit_card_id: int | None,
    amount: Decimal,
) -> None:
    if credit_card_id is None or amount == 0:
        return

    card = db.query(CreditCard).filter(CreditCard.id == credit_card_id).first()

    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    card.current_spend_progress = Decimal(card.current_spend_progress or 0) + amount
    card.current_balance = Decimal(card.current_balance or 0) + amount
    card.updated_at = datetime.utcnow()


@router.post("/")
def create_purchase_batch(payload: PurchaseBatchCreate):
    db: Session = SessionLocal()

    try:
        batch = PurchaseBatch(
            store_name=payload.store_name,
            purchase_date=payload.purchase_date,
            total_amount=payload.total_amount,
            purchase_total_paid=payload.purchase_total_paid,
            sales_tax=payload.sales_tax,
            activation_fees=payload.activation_fees,
            discounts=payload.discounts,
            fuel_point_estimated_value=payload.fuel_point_estimated_value,
            fuel_points_quantity=payload.fuel_points_quantity,
            fuel_points_unit=payload.fuel_points_unit,
            fuel_points_notes=payload.fuel_points_notes,
            financial_notes=payload.financial_notes,
            notes=payload.notes,
            credit_card_id=payload.credit_card_id,
        )
        db.add(batch)
        db.flush()

        if payload.credit_card_id and payload.purchase_total_paid:
            create_purchase_payment(
                db,
                batch.id,
                PurchasePaymentCreate(
                    payment_type="CREDIT_CARD",
                    credit_card_id=payload.credit_card_id,
                    amount=payload.purchase_total_paid,
                    notes="Created from funding card",
                ),
            )

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
        
@router.get("/{purchase_batch_id}")
def get_purchase_batch(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        return (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == purchase_batch_id)
            .first()
        )

    finally:
        db.close()


@router.patch("/{purchase_batch_id}/recalculate-allocation")
def recalculate_allocation(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        allocation = recalculate_purchase_allocation(db, purchase_batch_id)

        if allocation is None:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        db.commit()

        return allocation

    finally:
        db.close()


@router.patch("/{purchase_batch_id}")
def update_purchase_batch(purchase_batch_id: int, payload: PurchaseBatchUpdate):
    db: Session = SessionLocal()

    try:
        batch = (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == purchase_batch_id)
            .first()
        )

        if not batch:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        payload_fields = get_payload_fields(payload)
        for field in payload_fields:
            setattr(batch, field, getattr(payload, field))

        batch.updated_at = datetime.utcnow()

        if "purchase_total_paid" in payload_fields:
            recalculate_purchase_allocation(db, purchase_batch_id)

        db.commit()
        db.refresh(batch)

        return batch

    finally:
        db.close()
