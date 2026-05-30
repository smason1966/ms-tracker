from datetime import datetime
from app.utils.time import utc_now
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.credit_card import CreditCard
from app.models.purchase_batch import PurchaseBatch
from app.models.purchase_payment import PurchasePayment
from app.services.credit_card_rewards import (
    calculate_reward_components,
    get_purchase_spending_category_id,
    resolve_reward_for_purchase_payment,
    sync_automatic_reward_transactions,
)
from app.services.purchase_allocation import recalculate_purchase_allocation


router = APIRouter(tags=["purchase-payments"])

PAYMENT_TYPES = {"CREDIT_CARD", "CASH", "OTHER"}


class PurchasePaymentCreate(BaseModel):
    payment_type: str
    credit_card_id: int | None = None
    amount: Decimal
    spending_category_id: int | None = None
    reward_multiplier: Decimal | None = None
    estimated_rewards_earned: Decimal | None = None
    rewards_type: str | None = None
    notes: str | None = None


class PurchasePaymentsReplace(BaseModel):
    payments: list[PurchasePaymentCreate]


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
    card.updated_at = utc_now()


def calculate_reward_estimate(
    db: Session,
    purchase: PurchaseBatch,
    payload: PurchasePaymentCreate,
) -> dict:
    if payload.payment_type.strip().upper() != "CREDIT_CARD" or not payload.credit_card_id:
        return {
            "spending_category_id": payload.spending_category_id,
            "reward_multiplier": None,
            "estimated_rewards_earned": None,
            "rewards_type": payload.rewards_type,
            "reward_program_id": None,
            "calculation_source": None,
            "product_snapshot": None,
            "matched_rule_id": None,
            "reward_type": None,
            "points_earned": None,
            "cashback_amount": None,
            "statement_credit_amount": None,
            "purchase_discount_amount": None,
            "effective_savings_amount": None,
            "priority": None,
        }

    card = db.query(CreditCard).filter(CreditCard.id == payload.credit_card_id).first()

    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    spending_category_id = (
        payload.spending_category_id or get_purchase_spending_category_id(db, purchase)
    )
    resolution = resolve_reward_for_purchase_payment(
        db,
        purchase=purchase,
        card=card,
        spending_category_id=spending_category_id,
        manual_multiplier=payload.reward_multiplier,
    )
    multiplier = Decimal(resolution["final_multiplier"])
    reward_program_id = resolution["reward_program_id"]
    calculation_source = resolution["calculation_source"]
    components = calculate_reward_components(
        purchase=purchase,
        amount=Decimal(payload.amount),
        reward_type=resolution["reward_type"],
        multiplier=multiplier,
        value=Decimal(resolution["rule_value"]),
    )

    estimated_rewards = (
        payload.estimated_rewards_earned
        if payload.estimated_rewards_earned is not None
        else components["rewards_earned"]
    )

    return {
        "spending_category_id": spending_category_id,
        "reward_multiplier": multiplier,
        "estimated_rewards_earned": estimated_rewards,
        "rewards_type": payload.rewards_type or card.rewards_type,
        "reward_program_id": reward_program_id,
        "calculation_source": calculation_source,
        "product_snapshot": card.nickname,
        "matched_rule_id": resolution["matched_rule_id"],
        "reward_type": resolution["reward_type"],
        "points_earned": components["points_earned"],
        "cashback_amount": components["cashback_amount"],
        "statement_credit_amount": components["statement_credit_amount"],
        "purchase_discount_amount": components["purchase_discount_amount"],
        "effective_savings_amount": components["effective_savings_amount"],
        "priority": resolution["priority"],
    }


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

    reward_estimate = calculate_reward_estimate(db, purchase, payload)

    payment = PurchasePayment(
        purchase_batch_id=purchase_batch_id,
        payment_type=payment_type,
        credit_card_id=payload.credit_card_id,
        spending_category_id=reward_estimate["spending_category_id"],
        reward_program_id=reward_estimate["reward_program_id"],
        matched_rule_id=reward_estimate["matched_rule_id"],
        amount=payload.amount,
        reward_multiplier=reward_estimate["reward_multiplier"],
        estimated_rewards_earned=reward_estimate["estimated_rewards_earned"],
        applied_multiplier=reward_estimate["reward_multiplier"],
        calculated_rewards=reward_estimate["estimated_rewards_earned"],
        reward_type=reward_estimate["reward_type"],
        points_earned=reward_estimate["points_earned"],
        cashback_amount=reward_estimate["cashback_amount"],
        statement_credit_amount=reward_estimate["statement_credit_amount"],
        purchase_discount_amount=reward_estimate["purchase_discount_amount"],
        effective_savings_amount=reward_estimate["effective_savings_amount"],
        priority=reward_estimate["priority"],
        calculation_source=reward_estimate["calculation_source"],
        credit_card_product_snapshot=reward_estimate["product_snapshot"],
        rewards_type=reward_estimate["rewards_type"],
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
        sync_automatic_reward_transactions(db, purchase_batch_id)
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

        purchase_batch_id = payment.purchase_batch_id
        db.delete(payment)
        db.flush()
        sync_automatic_reward_transactions(db, purchase_batch_id)
        db.commit()

        return {"deleted": True}
    finally:
        db.close()


@router.patch("/purchase-payments/{payment_id}")
def update_purchase_payment(payment_id: int, payload: PurchasePaymentCreate):
    db: Session = SessionLocal()

    try:
        payment = (
            db.query(PurchasePayment)
            .filter(PurchasePayment.id == payment_id)
            .first()
        )

        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")

        purchase_batch_id = payment.purchase_batch_id
        apply_credit_card_payment_delta(
            db,
            payment.payment_type,
            payment.credit_card_id,
            -Decimal(payment.amount),
        )
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

        reward_estimate = calculate_reward_estimate(db, purchase, payload)
        payment.payment_type = payment_type
        payment.credit_card_id = payload.credit_card_id
        payment.spending_category_id = reward_estimate["spending_category_id"]
        payment.reward_program_id = reward_estimate["reward_program_id"]
        payment.matched_rule_id = reward_estimate["matched_rule_id"]
        payment.amount = payload.amount
        payment.reward_multiplier = reward_estimate["reward_multiplier"]
        payment.estimated_rewards_earned = reward_estimate["estimated_rewards_earned"]
        payment.applied_multiplier = reward_estimate["reward_multiplier"]
        payment.calculated_rewards = reward_estimate["estimated_rewards_earned"]
        payment.reward_type = reward_estimate["reward_type"]
        payment.points_earned = reward_estimate["points_earned"]
        payment.cashback_amount = reward_estimate["cashback_amount"]
        payment.statement_credit_amount = reward_estimate["statement_credit_amount"]
        payment.purchase_discount_amount = reward_estimate["purchase_discount_amount"]
        payment.effective_savings_amount = reward_estimate["effective_savings_amount"]
        payment.priority = reward_estimate["priority"]
        payment.calculation_source = reward_estimate["calculation_source"]
        payment.credit_card_product_snapshot = reward_estimate["product_snapshot"]
        payment.rewards_type = reward_estimate["rewards_type"]
        payment.notes = payload.notes
        apply_credit_card_payment_delta(
            db,
            payment.payment_type,
            payment.credit_card_id,
            Decimal(payment.amount),
        )
        sync_automatic_reward_transactions(db, purchase_batch_id)
        db.commit()
        db.refresh(payment)
        return payment
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.put("/purchase-batches/{purchase_batch_id}/payments")
def replace_purchase_payments(
    purchase_batch_id: int,
    payload: PurchasePaymentsReplace,
):
    db: Session = SessionLocal()

    try:
        purchase = (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == purchase_batch_id)
            .first()
        )

        if not purchase:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        if not payload.payments:
            raise HTTPException(
                status_code=400,
                detail="At least one payment line is required",
            )

        existing_payments = (
            db.query(PurchasePayment)
            .filter(PurchasePayment.purchase_batch_id == purchase_batch_id)
            .all()
        )

        for payment in existing_payments:
            apply_credit_card_payment_delta(
                db,
                payment.payment_type,
                payment.credit_card_id,
                -Decimal(payment.amount),
            )
            db.delete(payment)

        db.flush()

        new_payments: list[PurchasePayment] = []

        for payment_payload in payload.payments:
            new_payment = create_purchase_payment(
                db,
                purchase_batch_id,
                payment_payload,
            )
            new_payments.append(new_payment)

        sync_automatic_reward_transactions(db, purchase_batch_id)

        credit_card_payments = [
            payment
            for payment in new_payments
            if payment.payment_type == "CREDIT_CARD"
        ]
        purchase.purchase_total_paid = sum(
            (Decimal(payment.amount) for payment in new_payments),
            Decimal("0"),
        )
        purchase.credit_card_id = (
            credit_card_payments[0].credit_card_id
            if len(credit_card_payments) == 1
            else None
        )
        purchase.updated_at = utc_now()
        recalculate_purchase_allocation(db, purchase_batch_id)

        db.commit()

        return (
            db.query(PurchasePayment)
            .filter(PurchasePayment.purchase_batch_id == purchase_batch_id)
            .order_by(PurchasePayment.created_at.asc())
            .all()
        )
    finally:
        db.close()
