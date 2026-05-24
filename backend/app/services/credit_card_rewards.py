from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.credit_card import CreditCard
from app.models.credit_card_reward_rule import CreditCardRewardRule
from app.models.credit_card_reward_transaction import CreditCardRewardTransaction
from app.models.purchase_batch import PurchaseBatch
from app.models.purchase_payment import PurchasePayment
from app.models.reward_program import RewardProgram
from app.models.spending_category import SpendingCategory
from app.models.store import Store


AUTOMATIC_REWARD_SOURCES = {
    "automatic",
    "product_change_snapshot",
    "effective_reward_rule",
    "general_reward_rule",
    "card_default_rate",
    "fallback_1x",
}


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    return Decimal(str(value))


def purchase_date_only(purchase: PurchaseBatch) -> date:
    value = purchase.purchase_date
    return value.date() if isinstance(value, datetime) else value


def get_purchase_spending_category_id(db: Session, purchase: PurchaseBatch) -> int | None:
    store = db.query(Store).filter(Store.name == purchase.store_name).first()

    if not store:
        return None

    if store.spending_category_id is not None:
        return store.spending_category_id

    if not store.merchant_category:
        return None

    category = (
        db.query(SpendingCategory)
        .filter(SpendingCategory.key == store.merchant_category)
        .first()
    )

    return category.id if category else None


def get_spending_category(db: Session, category_id: int | None) -> SpendingCategory | None:
    if category_id is None:
        return None

    return db.query(SpendingCategory).filter(SpendingCategory.id == category_id).first()


def get_general_spending_category(db: Session) -> SpendingCategory | None:
    return (
        db.query(SpendingCategory)
        .filter(
            or_(
                SpendingCategory.key.ilike("general"),
                SpendingCategory.name.ilike("general"),
            )
        )
        .first()
    )


def default_reward_program_id(db: Session, card: CreditCard) -> int | None:
    if card.reward_program_id is not None:
        return card.reward_program_id

    fallback_code = (card.rewards_type or "OTHER").upper()
    program = (
        db.query(RewardProgram)
        .filter(RewardProgram.short_code == fallback_code)
        .first()
    )

    if program:
        return program.id

    other = db.query(RewardProgram).filter(RewardProgram.short_code == "OTHER").first()
    return other.id if other else None


def find_effective_reward_rule(
    db: Session,
    *,
    card_id: int,
    spending_category_id: int | None,
    purchase_date: date,
) -> CreditCardRewardRule | None:
    if spending_category_id is None:
        return None

    return (
        db.query(CreditCardRewardRule)
        .filter(CreditCardRewardRule.credit_card_id == card_id)
        .filter(CreditCardRewardRule.spending_category_id == spending_category_id)
        .filter(CreditCardRewardRule.effective_start_date <= purchase_date)
        .filter(
            or_(
                CreditCardRewardRule.effective_end_date.is_(None),
                CreditCardRewardRule.effective_end_date >= purchase_date,
            )
        )
        .order_by(CreditCardRewardRule.effective_start_date.desc())
        .first()
    )


def format_multiplier(value: Decimal) -> str:
    normalized = value.normalize()
    text = format(normalized, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def serialize_rule_summary(
    db: Session,
    rule: CreditCardRewardRule | None,
) -> dict[str, Any] | None:
    if rule is None:
        return None

    category = get_spending_category(db, rule.spending_category_id)
    return {
        "id": rule.id,
        "category_id": rule.spending_category_id,
        "category_key": category.key if category else None,
        "category_name": category.name if category else None,
        "multiplier": rule.multiplier,
        "reward_program_id": rule.reward_program_id,
    }


def resolve_reward_for_purchase_payment(
    db: Session,
    *,
    purchase: PurchaseBatch,
    card: CreditCard,
    spending_category_id: int | None,
    manual_multiplier: Decimal | None = None,
) -> dict[str, Any]:
    purchase_date = purchase_date_only(purchase)
    purchase_category_id = spending_category_id
    category = get_spending_category(db, purchase_category_id)
    exact_rule = find_effective_reward_rule(
        db,
        card_id=card.id,
        spending_category_id=purchase_category_id,
        purchase_date=purchase_date,
    )
    general_category = get_general_spending_category(db)
    general_rule = (
        find_effective_reward_rule(
            db,
            card_id=card.id,
            spending_category_id=general_category.id,
            purchase_date=purchase_date,
        )
        if general_category is not None
        else None
    )

    if manual_multiplier is not None:
        multiplier = to_decimal(manual_multiplier)
        selected_rule = None
        calculation_source = "manual_override"
        reward_program_id = default_reward_program_id(db, card)
    elif exact_rule is not None:
        multiplier = to_decimal(exact_rule.multiplier)
        selected_rule = exact_rule
        calculation_source = "effective_reward_rule"
        reward_program_id = exact_rule.reward_program_id or default_reward_program_id(db, card)
    elif general_rule is not None:
        multiplier = to_decimal(general_rule.multiplier)
        selected_rule = general_rule
        calculation_source = "general_reward_rule"
        reward_program_id = general_rule.reward_program_id or default_reward_program_id(db, card)
    elif card.rewards_rate is not None:
        multiplier = to_decimal(card.rewards_rate)
        selected_rule = None
        calculation_source = "card_default_rate"
        reward_program_id = default_reward_program_id(db, card)
    else:
        multiplier = Decimal("1")
        selected_rule = None
        calculation_source = "fallback_1x"
        reward_program_id = default_reward_program_id(db, card)

    return {
        "merchant": purchase.store_name,
        "spending_category_id": purchase_category_id,
        "spending_category_name": category.name if category else None,
        "matched_rule": serialize_rule_summary(db, selected_rule if selected_rule == exact_rule else None),
        "fallback_rule": serialize_rule_summary(db, general_rule),
        "selected_rule": serialize_rule_summary(db, selected_rule),
        "final_multiplier": multiplier,
        "reward_program_id": reward_program_id,
        "calculation_source": calculation_source,
    }


def reward_resolution_note(
    existing_notes: str | None,
    resolution: dict[str, Any],
) -> str | None:
    debug_line = (
        "Reward resolution: "
        f"merchant={resolution['merchant'] or '-'}; "
        f"category={resolution['spending_category_name'] or 'Uncategorized'}; "
        f"matched_rule={resolution['matched_rule']['category_name'] if resolution['matched_rule'] else '-'}; "
        f"fallback_rule={resolution['fallback_rule']['category_name'] if resolution['fallback_rule'] else '-'}; "
        f"final_multiplier={format_multiplier(resolution['final_multiplier'])}x"
    )

    if existing_notes and existing_notes.strip():
        return f"{existing_notes.strip()}\n{debug_line}"

    return debug_line


def recalculate_rewards_for_credit_card(db: Session, credit_card_id: int) -> int:
    purchase_ids = [
        row[0]
        for row in (
            db.query(PurchasePayment.purchase_batch_id)
            .filter(PurchasePayment.payment_type == "CREDIT_CARD")
            .filter(PurchasePayment.credit_card_id == credit_card_id)
            .distinct()
            .all()
        )
    ]

    for purchase_id in purchase_ids:
        sync_automatic_reward_transactions(db, purchase_id)

    return len(purchase_ids)


def recalculate_rewards_for_store(db: Session, store_name: str) -> int:
    purchase_ids = [
        row[0]
        for row in (
            db.query(PurchaseBatch.id)
            .filter(PurchaseBatch.store_name == store_name)
            .all()
        )
    ]

    for purchase_id in purchase_ids:
        sync_automatic_reward_transactions(db, purchase_id)

    return len(purchase_ids)


def sync_automatic_reward_transactions(db: Session, purchase_id: int) -> list[CreditCardRewardTransaction]:
    db.flush()
    purchase = db.query(PurchaseBatch).filter(PurchaseBatch.id == purchase_id).first()

    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase batch not found")

    manual_count = (
        db.query(CreditCardRewardTransaction)
        .filter(CreditCardRewardTransaction.purchase_id == purchase_id)
        .filter(CreditCardRewardTransaction.calculation_source == "manual_override")
        .count()
    )

    if manual_count:
        return (
            db.query(CreditCardRewardTransaction)
            .filter(CreditCardRewardTransaction.purchase_id == purchase_id)
            .order_by(CreditCardRewardTransaction.created_at.desc())
            .all()
        )

    db.query(CreditCardRewardTransaction).filter(
        CreditCardRewardTransaction.purchase_id == purchase_id,
    ).filter(
        CreditCardRewardTransaction.calculation_source.in_(AUTOMATIC_REWARD_SOURCES),
    ).delete(synchronize_session=False)

    purchase_date = purchase_date_only(purchase)
    spending_category_id = get_purchase_spending_category_id(db, purchase)
    payments = (
        db.query(PurchasePayment)
        .filter(PurchasePayment.purchase_batch_id == purchase_id)
        .filter(PurchasePayment.payment_type == "CREDIT_CARD")
        .filter(PurchasePayment.credit_card_id.isnot(None))
        .all()
    )
    transactions: list[CreditCardRewardTransaction] = []

    for payment in payments:
        card = db.query(CreditCard).filter(CreditCard.id == payment.credit_card_id).first()

        if not card:
            continue

        transaction_category_id = payment.spending_category_id or spending_category_id
        resolution = resolve_reward_for_purchase_payment(
            db,
            purchase=purchase,
            card=card,
            spending_category_id=transaction_category_id,
        )
        multiplier = resolution["final_multiplier"]
        reward_program_id = resolution["reward_program_id"] or payment.reward_program_id
        rewards_earned = to_decimal(payment.amount) * multiplier
        calculation_source = resolution["calculation_source"]

        transaction = CreditCardRewardTransaction(
            purchase_id=purchase_id,
            credit_card_id=card.id,
            player_id=purchase.player_id or card.player_id,
            reward_program_id=reward_program_id,
            spending_category_id=transaction_category_id,
            purchase_date=purchase_date,
            qualifying_spend=payment.amount,
            multiplier=multiplier,
            rewards_earned=rewards_earned,
            calculation_source=calculation_source,
            credit_card_product_snapshot=card.nickname,
            notes=reward_resolution_note(payment.notes, resolution),
        )
        db.add(transaction)
        transactions.append(transaction)

        payment.spending_category_id = transaction_category_id
        payment.reward_program_id = reward_program_id
        payment.reward_multiplier = multiplier
        payment.applied_multiplier = multiplier
        payment.estimated_rewards_earned = rewards_earned
        payment.calculated_rewards = rewards_earned
        payment.calculation_source = calculation_source
        payment.credit_card_product_snapshot = card.nickname
        payment.rewards_type = card.rewards_type

    db.flush()
    return transactions


def replace_with_manual_reward_override(
    db: Session,
    *,
    purchase_id: int,
    credit_card_id: int | None,
    reward_program_id: int | None,
    spending_category_id: int | None,
    qualifying_spend: Decimal,
    multiplier: Decimal,
    rewards_earned: Decimal,
    notes: str | None,
) -> CreditCardRewardTransaction:
    purchase = db.query(PurchaseBatch).filter(PurchaseBatch.id == purchase_id).first()

    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase batch not found")

    card_id = credit_card_id or purchase.credit_card_id
    if card_id is None:
        payment = (
            db.query(PurchasePayment)
            .filter(PurchasePayment.purchase_batch_id == purchase_id)
            .filter(PurchasePayment.payment_type == "CREDIT_CARD")
            .filter(PurchasePayment.credit_card_id.isnot(None))
            .first()
        )
        card_id = payment.credit_card_id if payment else None

    if card_id is None:
        raise HTTPException(status_code=400, detail="Credit card is required for reward override")

    card = db.query(CreditCard).filter(CreditCard.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    resolved_reward_program_id = reward_program_id or default_reward_program_id(db, card)

    db.query(CreditCardRewardTransaction).filter(
        CreditCardRewardTransaction.purchase_id == purchase_id,
    ).delete(synchronize_session=False)

    transaction = CreditCardRewardTransaction(
        purchase_id=purchase_id,
        credit_card_id=card_id,
        player_id=purchase.player_id or card.player_id,
        reward_program_id=resolved_reward_program_id,
        spending_category_id=spending_category_id or get_purchase_spending_category_id(db, purchase),
        purchase_date=purchase_date_only(purchase),
        qualifying_spend=qualifying_spend,
        multiplier=multiplier,
        rewards_earned=rewards_earned,
        calculation_source="manual_override",
        credit_card_product_snapshot=card.nickname,
        notes=notes,
    )
    db.add(transaction)
    db.flush()
    return transaction


def serialize_reward_transaction(db: Session, transaction: CreditCardRewardTransaction) -> dict:
    card = db.query(CreditCard).filter(CreditCard.id == transaction.credit_card_id).first()
    purchase = (
        db.query(PurchaseBatch)
        .filter(PurchaseBatch.id == transaction.purchase_id)
        .first()
    )
    program = (
        db.query(RewardProgram)
        .filter(RewardProgram.id == transaction.reward_program_id)
        .first()
        if transaction.reward_program_id is not None
        else None
    )
    category = (
        db.query(SpendingCategory)
        .filter(SpendingCategory.id == transaction.spending_category_id)
        .first()
        if transaction.spending_category_id is not None
        else None
    )

    resolution = (
        resolve_reward_for_purchase_payment(
            db,
            purchase=purchase,
            card=card,
            spending_category_id=transaction.spending_category_id,
        )
        if card is not None
        and purchase is not None
        and transaction.calculation_source != "manual_override"
        else None
    )

    if resolution is not None:
        resolution["final_multiplier"] = transaction.multiplier

    return {
        "id": transaction.id,
        "purchase_id": transaction.purchase_id,
        "credit_card_id": transaction.credit_card_id,
        "player_id": transaction.player_id,
        "reward_program_id": transaction.reward_program_id,
        "spending_category_id": transaction.spending_category_id,
        "purchase_date": transaction.purchase_date,
        "qualifying_spend": transaction.qualifying_spend,
        "multiplier": transaction.multiplier,
        "rewards_earned": transaction.rewards_earned,
        "calculation_source": transaction.calculation_source,
        "credit_card_product_snapshot": transaction.credit_card_product_snapshot,
        "notes": transaction.notes,
        "reward_resolution": resolution,
        "created_at": transaction.created_at,
        "credit_card": (
            {
                "id": card.id,
                "nickname": card.nickname,
                "last_four": card.last_four,
            }
            if card
            else None
        ),
        "reward_program": (
            {
                "id": program.id,
                "name": program.name,
                "short_code": program.short_code,
                "category": program.category,
                "estimated_value_cents_per_point": program.estimated_value_cents_per_point,
            }
            if program
            else None
        ),
        "spending_category": (
            {
                "id": category.id,
                "key": category.key,
                "name": category.name,
            }
            if category
            else None
        ),
    }
