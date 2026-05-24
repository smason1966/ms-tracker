from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.credit_card import CreditCard
from app.models.credit_card_reward_rule import CreditCardRewardRule
from app.models.credit_card_reward_transaction import CreditCardRewardTransaction
from app.models.purchase_payment import PurchasePayment
from app.models.reward_program import RewardProgram
from app.models.store import Store
from app.services.reward_program_categories import active_reward_program_category_names
from app.services.reward_program_defaults import (
    default_credit_card_eligibility,
    ensure_default_reward_program_values,
)


router = APIRouter(prefix="/reward-programs", tags=["reward-programs"])

SYSTEM_REWARD_PROGRAM_CODES = {
    "CASH",
    "UR",
    "MR",
    "TY",
    "C1",
    "AA",
    "UA",
    "AS",
    "DL",
    "MILES",
    "HH",
    "HYATT",
    "BONVOY",
    "KROGER_FUEL",
    "OTHER",
    "BTC",
    "ETH",
    "USDC",
    "GEMINI",
    "COINBASE",
    "CRYPTOCOM",
    "OTHER_CRYPTO",
}


class RewardProgramCreate(BaseModel):
    name: str
    short_code: str
    category: str
    estimated_value_cents_per_point: Decimal | None = None
    value_unit: str | None = "cents_per_point"
    eligible_for_credit_cards: bool | None = None
    transferable: bool = False
    active: bool = True
    notes: str | None = None


class RewardProgramUpdate(BaseModel):
    name: str | None = None
    short_code: str | None = None
    category: str | None = None
    estimated_value_cents_per_point: Decimal | None = None
    value_unit: str | None = None
    eligible_for_credit_cards: bool | None = None
    transferable: bool | None = None
    active: bool | None = None
    notes: str | None = None


def normalize_category(db: Session, value: str) -> str:
    normalized = value.strip()

    if normalized not in active_reward_program_category_names(db):
        raise HTTPException(status_code=400, detail="Invalid reward program category")

    return normalized


def normalized_code(value: str) -> str:
    return value.strip().upper()


def normalized_name(value: str) -> str:
    return " ".join(value.strip().split())


def duplicate_program_error(program: RewardProgram, duplicate_field: str) -> HTTPException:
    status = "active" if program.active else "inactive"
    action = (
        "Use the existing active program."
        if program.active
        else "Reactivate it instead?"
    )
    field_label = "Code" if duplicate_field == "short_code" else "Name"
    field_value = program.short_code if duplicate_field == "short_code" else program.name

    return HTTPException(
        status_code=409,
        detail={
            "message": f"{field_label} {field_value} already exists and is {status}. {action}",
            "code": "reward_program_duplicate",
            "duplicate_field": duplicate_field,
            "existing_program_id": program.id,
            "existing_program_status": status,
            "existing_program": {
                "id": program.id,
                "name": program.name,
                "short_code": program.short_code,
                "category": program.category,
                "eligible_for_credit_cards": program.eligible_for_credit_cards,
                "active": program.active,
            },
        },
    )


def find_duplicate_program(
    db: Session,
    *,
    short_code: str,
    name: str,
    exclude_program_id: int | None = None,
) -> tuple[RewardProgram, str] | None:
    query = db.query(RewardProgram).filter(
        or_(
            RewardProgram.short_code == short_code,
            func.lower(RewardProgram.name) == name.lower(),
        )
    )
    if exclude_program_id is not None:
        query = query.filter(RewardProgram.id != exclude_program_id)

    duplicate = query.order_by(RewardProgram.active.desc(), RewardProgram.id.asc()).first()
    if not duplicate:
        return None

    duplicate_field = (
        "short_code"
        if duplicate.short_code == short_code
        else "name"
    )
    return duplicate, duplicate_field


def program_protection(db: Session, program: RewardProgram) -> dict:
    linked_card_count = (
        db.query(CreditCard)
        .filter(CreditCard.reward_program_id == program.id)
        .count()
    )
    linked_payment_count = (
        db.query(PurchasePayment)
        .filter(PurchasePayment.reward_program_id == program.id)
        .count()
    )
    linked_rule_count = (
        db.query(CreditCardRewardRule)
        .filter(CreditCardRewardRule.reward_program_id == program.id)
        .count()
    )
    ledger_entry_count = (
        db.query(CreditCardRewardTransaction)
        .filter(CreditCardRewardTransaction.reward_program_id == program.id)
        .count()
    )
    linked_store_count = (
        db.query(Store)
        .filter(Store.reward_program_id == program.id)
        .count()
    )
    system_default = program.short_code in SYSTEM_REWARD_PROGRAM_CODES
    reasons: list[str] = []

    if system_default:
        reasons.append("System seeded default program")
    if linked_card_count:
        reasons.append(f"{linked_card_count} credit card(s) use this program")
    if linked_rule_count:
        reasons.append(f"{linked_rule_count} reward rule(s) use this program")
    if linked_payment_count:
        reasons.append(f"{linked_payment_count} payment allocation(s) use this program")
    if ledger_entry_count:
        reasons.append(f"{ledger_entry_count} reward ledger entr(y/ies) use this program")
    if linked_store_count:
        reasons.append(f"{linked_store_count} store(s) use this program")

    return {
        "linked_card_count": linked_card_count,
        "linked_payment_count": linked_payment_count,
        "linked_rule_count": linked_rule_count,
        "ledger_entry_count": ledger_entry_count,
        "linked_store_count": linked_store_count,
        "system_default": system_default,
        "protection_reasons": reasons,
        "protected": bool(reasons),
        "can_delete": not reasons,
        "can_deactivate": bool(reasons),
    }


def serialize_program(program: RewardProgram, db: Session | None = None) -> dict:
    protection = program_protection(db, program) if db else {}

    return {
        "id": program.id,
        "name": program.name,
        "short_code": program.short_code,
        "category": program.category,
        "estimated_value_cents_per_point": program.estimated_value_cents_per_point,
        "value_unit": program.value_unit,
        "eligible_for_credit_cards": program.eligible_for_credit_cards,
        "transferable": program.transferable,
        "active": program.active,
        "notes": program.notes,
        **protection,
        "created_at": program.created_at,
        "updated_at": program.updated_at,
    }


@router.get("/")
def list_reward_programs(
    active_only: bool = False,
    eligible_for_credit_cards: bool | None = None,
):
    db: Session = SessionLocal()

    try:
        ensure_default_reward_program_values(db)
        db.commit()
        query = db.query(RewardProgram)
        if active_only:
            query = query.filter(RewardProgram.active.is_(True))
        if eligible_for_credit_cards is not None:
            query = query.filter(
                RewardProgram.eligible_for_credit_cards.is_(
                    eligible_for_credit_cards,
                )
            )
        programs = query.order_by(RewardProgram.category.asc(), RewardProgram.name.asc()).all()
        return [serialize_program(program, db) for program in programs]
    finally:
        db.close()


@router.post("/")
def create_reward_program(payload: RewardProgramCreate):
    db: Session = SessionLocal()

    try:
        code = normalized_code(payload.short_code)
        name = normalized_name(payload.name)
        duplicate = find_duplicate_program(db, short_code=code, name=name)
        if duplicate:
            raise duplicate_program_error(*duplicate)

        program = RewardProgram(
            name=name,
            short_code=code,
            category=normalize_category(db, payload.category),
            estimated_value_cents_per_point=payload.estimated_value_cents_per_point,
            value_unit=payload.value_unit,
            eligible_for_credit_cards=(
                payload.eligible_for_credit_cards
                if payload.eligible_for_credit_cards is not None
                else default_credit_card_eligibility(payload.category)
            ),
            transferable=payload.transferable,
            active=payload.active,
            notes=payload.notes,
        )
        db.add(program)
        db.commit()
        db.refresh(program)
        return serialize_program(program, db)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        duplicate = find_duplicate_program(
            db,
            short_code=normalized_code(payload.short_code),
            name=normalized_name(payload.name),
        )
        if duplicate:
            raise duplicate_program_error(*duplicate) from exc
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Reward program conflicts with an existing record.",
                "code": "reward_program_duplicate",
            },
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Unable to save reward program",
                "error": str(exc),
            },
        ) from exc
    finally:
        db.close()


@router.patch("/{program_id}")
def update_reward_program(program_id: int, payload: RewardProgramUpdate):
    db: Session = SessionLocal()

    try:
        program = db.query(RewardProgram).filter(RewardProgram.id == program_id).first()
        if not program:
            raise HTTPException(status_code=404, detail="Reward program not found")

        update_data = payload.model_dump(exclude_unset=True)
        next_code = (
            normalized_code(update_data["short_code"])
            if "short_code" in update_data and update_data["short_code"] is not None
            else program.short_code
        )
        next_name = (
            normalized_name(update_data["name"])
            if "name" in update_data and update_data["name"] is not None
            else program.name
        )
        duplicate = find_duplicate_program(
            db,
            short_code=next_code,
            name=next_name,
            exclude_program_id=program.id,
        )
        if duplicate:
            raise duplicate_program_error(*duplicate)

        for field, value in update_data.items():
            if field == "short_code" and value is not None:
                value = normalized_code(value)
            elif field == "name" and value is not None:
                value = normalized_name(value)
            elif field == "category" and value is not None:
                value = normalize_category(db, value)
            setattr(program, field, value)

        program.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(program)
        return serialize_program(program, db)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Reward program conflicts with an existing record.",
                "code": "reward_program_duplicate",
            },
        ) from exc
    finally:
        db.close()


@router.delete("/{program_id}")
def delete_reward_program(program_id: int):
    db: Session = SessionLocal()

    try:
        program = db.query(RewardProgram).filter(RewardProgram.id == program_id).first()
        if not program:
            raise HTTPException(status_code=404, detail="Reward program not found")

        protection = program_protection(db, program)

        if not protection["can_delete"]:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Reward program is protected. Deactivate it instead.",
                    "reasons": protection["protection_reasons"],
                },
            )

        db.delete(program)
        db.commit()
        return {"deleted": True, "reward_program_id": program_id}
    finally:
        db.close()
