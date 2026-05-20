from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.credit_card import CreditCard
from app.models.purchase_batch import PurchaseBatch
from app.models.purchase_payment import PurchasePayment


router = APIRouter(tags=["purchase-payments"])

PAYMENT_TYPES = {"CREDIT_CARD", "CASH", "OTHER"}


class PurchasePaymentCreate(BaseModel):
    payment_type: str
    credit_card_id: int | None = None
    amount: Decimal
    notes: str | None = None


def normalize_payment_type(value: str) -> str:
    normalized = value.strip().upper()

    if normalized not in PAYMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid payment_type")

    return normalized


def apply_credit_card_payment_delta(
    db: Session,
    payment_type: str,
    credit_card_id: int | None,
    amount: Decimal,
) -> None:
    if payment_type != "CREDIT_CARD":
        return

    if credit_card_id is None:
        raise HTTPException(
            status_code=400,
            detail="credit_card_id is required for CREDIT_CARD payments",
        )

    card = db.query(CreditCard).filter(CreditCard.id == credit_card_id).first()

    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    card.current_spend_progress = Decimal(card.current_spend_progress or 0) + amount
    card.current_balance = Decimal(card.current_balance or 0) + amount
    card.updated_at = datetime.utcnow()


def create_purchase_payment(
    db: Session,
    purchase_batch_id: int,
    payload: PurchasePaymentCreate,
) -> PurchasePayment:
    payment_type = normalize_payment_type(payload.payment_type)

    if payment_type != "CREDIT_CARD" and payload.credit_card_id is not None:
        raise HTTPException(
            status_code=400,
            detail="credit_card_id is only allowed for CREDIT_CARD payments",
        )

    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be positive")

    purchase = (
        db.query(PurchaseBatch)
        .filter(PurchaseBatch.id == purchase_batch_id)
        .first()
    )

    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase batch not found")

    payment = PurchasePayment(
        purchase_batch_id=purchase_batch_id,
        payment_type=payment_type,
        credit_card_id=payload.credit_card_id,
        amount=payload.amount,
        notes=payload.notes,
    )

    db.add(payment)
    apply_credit_card_payment_delta(
        db,
        payment.payment_type,
        payment.credit_card_id,
        Decimal(payment.amount),
    )

    return payment


@router.get("/purchase-batches/{purchase_batch_id}/payments")
def list_purchase_payments(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        return (
            db.query(PurchasePayment)
            .filter(PurchasePayment.purchase_batch_id == purchase_batch_id)
            .order_by(PurchasePayment.created_at.asc())
            .all()
        )
    finally:
        db.close()


@router.post("/purchase-batches/{purchase_batch_id}/payments")
def add_purchase_payment(
    purchase_batch_id: int,
    payload: PurchasePaymentCreate,
):
    db: Session = SessionLocal()

    try:
        payment = create_purchase_payment(db, purchase_batch_id, payload)
        db.commit()
        db.refresh(payment)
        return payment
    finally:
        db.close()


@router.delete("/purchase-payments/{payment_id}")
def delete_purchase_payment(payment_id: int):
    db: Session = SessionLocal()

    try:
        payment = (
            db.query(PurchasePayment)
            .filter(PurchasePayment.id == payment_id)
            .first()
        )

        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")

        apply_credit_card_payment_delta(
            db,
            payment.payment_type,
            payment.credit_card_id,
            -Decimal(payment.amount),
        )

        db.delete(payment)
        db.commit()

        return {"deleted": True}
    finally:
        db.close()
