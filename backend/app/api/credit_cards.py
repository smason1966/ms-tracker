from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.credit_card import CreditCard


router = APIRouter(prefix="/credit-cards", tags=["credit-cards"])

REWARDS_TYPES = {"CASHBACK", "MR", "UR", "TY", "MILES", "OTHER"}


class CreditCardCreate(BaseModel):
    nickname: str
    issuer: str
    network: str | None = None
    last_four: str | None = None
    credit_limit: Decimal
    current_balance: Decimal | None = None
    statement_close_day: int | None = None
    payment_due_day: int | None = None
    opened_date: date | None = None
    annual_fee: Decimal | None = None
    signup_bonus_points: int | None = None
    signup_bonus_spend: Decimal | None = None
    signup_bonus_deadline: date | None = None
    current_spend_progress: Decimal = Decimal("0")
    rewards_type: str = "OTHER"
    rewards_rate: Decimal | None = None
    is_active: bool = True
    notes: str | None = None


class CreditCardUpdate(BaseModel):
    nickname: str | None = None
    issuer: str | None = None
    network: str | None = None
    last_four: str | None = None
    credit_limit: Decimal | None = None
    current_balance: Decimal | None = None
    statement_close_day: int | None = None
    payment_due_day: int | None = None
    opened_date: date | None = None
    annual_fee: Decimal | None = None
    signup_bonus_points: int | None = None
    signup_bonus_spend: Decimal | None = None
    signup_bonus_deadline: date | None = None
    current_spend_progress: Decimal | None = None
    rewards_type: str | None = None
    rewards_rate: Decimal | None = None
    is_active: bool | None = None
    notes: str | None = None


def get_payload_fields(payload: BaseModel) -> set[str]:
    return set(
        getattr(
            payload,
            "model_fields_set",
            getattr(payload, "__fields_set__", set()),
        )
    )


def days_until_day(day: int | None) -> int | None:
    if day is None:
        return None

    today = date.today()
    target_day = min(day, monthrange(today.year, today.month)[1])
    target = date(today.year, today.month, target_day)

    if target < today:
        next_month = today.month + 1
        next_year = today.year

        if next_month == 13:
            next_month = 1
            next_year += 1

        target_day = min(day, monthrange(next_year, next_month)[1])
        target = date(next_year, next_month, target_day)

    return (target - today).days


def serialize_card(card: CreditCard) -> dict:
    credit_limit = Decimal(card.credit_limit or 0)
    current_balance = Decimal(card.current_balance or 0)
    signup_bonus_spend = card.signup_bonus_spend
    current_spend_progress = Decimal(card.current_spend_progress or 0)
    utilization = (
        float((current_balance / credit_limit) * 100)
        if credit_limit > 0
        else None
    )
    msr_remaining = (
        max(Decimal("0"), Decimal(signup_bonus_spend) - current_spend_progress)
        if signup_bonus_spend is not None
        else None
    )

    return {
        "id": card.id,
        "nickname": card.nickname,
        "issuer": card.issuer,
        "network": card.network,
        "last_four": card.last_four,
        "credit_limit": card.credit_limit,
        "current_balance": card.current_balance,
        "statement_close_day": card.statement_close_day,
        "payment_due_day": card.payment_due_day,
        "opened_date": card.opened_date,
        "annual_fee": card.annual_fee,
        "signup_bonus_points": card.signup_bonus_points,
        "signup_bonus_spend": card.signup_bonus_spend,
        "signup_bonus_deadline": card.signup_bonus_deadline,
        "current_spend_progress": card.current_spend_progress,
        "rewards_type": card.rewards_type,
        "rewards_rate": card.rewards_rate,
        "is_active": card.is_active,
        "notes": card.notes,
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "utilization_percent": utilization,
        "msr_remaining": msr_remaining,
        "days_until_statement_close": days_until_day(card.statement_close_day),
        "days_until_payment_due": days_until_day(card.payment_due_day),
    }


def validate_rewards_type(value: str) -> str:
    normalized = value.strip().upper()

    if normalized not in REWARDS_TYPES:
        raise HTTPException(status_code=400, detail="Invalid rewards_type")

    return normalized


@router.get("")
def list_credit_cards():
    db: Session = SessionLocal()

    try:
        cards = db.query(CreditCard).order_by(CreditCard.nickname.asc()).all()
        return [serialize_card(card) for card in cards]
    finally:
        db.close()


@router.post("")
def create_credit_card(payload: CreditCardCreate):
    db: Session = SessionLocal()

    try:
        card = CreditCard(
            **getattr(payload, "model_dump", payload.dict)()
        )
        card.rewards_type = validate_rewards_type(payload.rewards_type)
        db.add(card)
        db.commit()
        db.refresh(card)
        return serialize_card(card)
    finally:
        db.close()


@router.get("/{card_id}")
def get_credit_card(card_id: int):
    db: Session = SessionLocal()

    try:
        card = db.query(CreditCard).filter(CreditCard.id == card_id).first()

        if not card:
            raise HTTPException(status_code=404, detail="Credit card not found")

        return serialize_card(card)
    finally:
        db.close()


@router.patch("/{card_id}")
def update_credit_card(card_id: int, payload: CreditCardUpdate):
    db: Session = SessionLocal()

    try:
        card = db.query(CreditCard).filter(CreditCard.id == card_id).first()

        if not card:
            raise HTTPException(status_code=404, detail="Credit card not found")

        for field in get_payload_fields(payload):
            value = getattr(payload, field)

            if field == "rewards_type" and value is not None:
                value = validate_rewards_type(value)

            setattr(card, field, value)

        card.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(card)
        return serialize_card(card)
    finally:
        db.close()
