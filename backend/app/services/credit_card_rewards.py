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
    "merchant_reward_rule",
    "product_change_snapshot",
    "effective_reward_rule",
    "general_reward_rule",
    "card_default_rate",
    "fallback_1x",
}
REWARD_TYPES = {
    "points",
    "points_multiplier",
    "cashback_percent",
    "statement_credit",
    "instant_discount_percent",
    "purchase_discount",
    "none",
}


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    return Decimal(str(value))


def normalize_key(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip().lower().replace(" ", "_").replace("-", "_")
    return normalized or None


def normalize_reward_type(value: str | None) -> str:
    normalized = normalize_key(value) or "points"
    if normalized == "points_multiplier":
        return "points"

    if normalized not in REWARD_TYPES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_reward_type",
                "allowed_values": sorted(REWARD_TYPES),
                "received": value,
            },
        )

    return normalized


def purchase_date_only(purchase: PurchaseBatch) -> date:
    value = purchase.purchase_date
    return value.date() if isinstance(value, datetime) else value


def get_purchase_store(db: Session, purchase: PurchaseBatch) -> Store | None:
    return db.query(Store).filter(Store.name == purchase.store_name).first()


def get_purchase_spending_category_id(db: Session, purchase: PurchaseBatch) -> int | None:
    store = get_purchase_store(db, purchase)

    if not store:
        return None

    if store.spending_category_id is not None:
        return store.spending_category_id

    category_key = store.merchant_category or store.merchant_type
    if not category_key:
        return None

    category = (
        db.query(SpendingCategory)
        .filter(SpendingCategory.key == normalize_key(category_key))
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
        .filter(CreditCardRewardRule.active.is_(True))
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


def get_effective_reward_rules(
    db: Session,
    *,
    card_id: int,
    purchase_date: date,
) -> list[CreditCardRewardRule]:
    return (
        db.query(CreditCardRewardRule)
        .filter(CreditCardRewardRule.credit_card_id == card_id)
        .filter(CreditCardRewardRule.active.is_(True))
        .filter(CreditCardRewardRule.effective_start_date <= purchase_date)
        .filter(
            or_(
                CreditCardRewardRule.effective_end_date.is_(None),
                CreditCardRewardRule.effective_end_date >= purchase_date,
            )
        )
        .all()
    )


def merchant_tokens(store: Store | None, purchase: PurchaseBatch) -> set[str]:
    values = {
        purchase.store_name,
        store.name if store else None,
        store.store_type if store else None,
        store.retailer_group if store else None,
        store.merchant_category if store else None,
        store.merchant_type if store else None,
    }

    return {normalized for value in values if (normalized := normalize_key(value))}


def rule_has_merchant_target(rule: CreditCardRewardRule) -> bool:
    return rule.store_id is not None or bool(normalize_key(rule.merchant_type))


def rule_matches_merchant(rule: CreditCardRewardRule, store: Store | None, tokens: set[str]) -> bool:
    if rule.store_id is not None:
        return store is not None and rule.store_id == store.id

    merchant_type = normalize_key(rule.merchant_type)
    return merchant_type is not None and merchant_type in tokens


def select_best_reward_rule(
    db: Session,
    *,
    card_id: int,
    spending_category_id: int | None,
    store: Store | None,
    purchase: PurchaseBatch,
    purchase_date: date,
) -> tuple[CreditCardRewardRule | None, str]:
    rules = get_effective_reward_rules(db, card_id=card_id, purchase_date=purchase_date)
    tokens = merchant_tokens(store, purchase)
    general_category = get_general_spending_category(db)

    def sort_key(rule: CreditCardRewardRule) -> tuple[int, date, Decimal]:
        return (
            rule.priority if rule.priority is not None else 100,
            date.max - rule.effective_start_date,
            -to_decimal(rule.value if rule.value is not None else rule.multiplier),
        )

    merchant_rules = [
        rule
        for rule in rules
        if rule_has_merchant_target(rule) and rule_matches_merchant(rule, store, tokens)
    ]
    if merchant_rules:
        return sorted(merchant_rules, key=sort_key)[0], "merchant_reward_rule"

    category_rules = [
        rule
        for rule in rules
        if (
            spending_category_id is not None
            and rule.spending_category_id == spending_category_id
            and not rule_has_merchant_target(rule)
        )
    ]
    if category_rules:
        return sorted(category_rules, key=sort_key)[0], "effective_reward_rule"

    general_rules = [
        rule
        for rule in rules
        if (
            general_category is not None
            and rule.spending_category_id == general_category.id
            and not rule_has_merchant_target(rule)
        )
    ]
    if general_rules:
        return sorted(general_rules, key=sort_key)[0], "general_reward_rule"

    return None, "fallback"


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
        "store_id": rule.store_id,
        "merchant_type": rule.merchant_type,
        "reward_type": rule.reward_type,
        "multiplier": rule.multiplier,
        "value": rule.value,
        "priority": rule.priority,
        "reward_program_id": rule.reward_program_id,
    }


def calculate_reward_components(
    *,
    purchase: PurchaseBatch,
    amount: Decimal,
    reward_type: str,
    multiplier: Decimal,
    value: Decimal,
) -> dict[str, Decimal]:
    reward_type = normalize_reward_type(reward_type)
    points_earned = Decimal("0")
    cashback_amount = Decimal("0")
    statement_credit_amount = Decimal("0")
    purchase_discount_amount = Decimal("0")

    if reward_type == "points":
        points_earned = amount * multiplier
    elif reward_type == "cashback_percent":
        cashback_amount = amount * value / Decimal("100")
    elif reward_type == "statement_credit":
        statement_credit_amount = value
    elif reward_type in {"instant_discount_percent", "purchase_discount"}:
        implied_discount = amount * value / Decimal("100")
        if purchase.purchase_total_paid is not None:
            implied_discount = max(
                Decimal("0"),
                to_decimal(purchase.total_amount) - to_decimal(purchase.purchase_total_paid),
            )
        purchase_discount_amount = implied_discount

    effective_savings_amount = cashback_amount + statement_credit_amount + purchase_discount_amount

    return {
        "rewards_earned": points_earned,
        "points_earned": points_earned,
        "cashback_amount": cashback_amount,
        "statement_credit_amount": statement_credit_amount,
        "purchase_discount_amount": purchase_discount_amount,
        "effective_savings_amount": effective_savings_amount,
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
    store = get_purchase_store(db, purchase)
    selected_rule, rule_source = select_best_reward_rule(
        db,
        card_id=card.id,
        spending_category_id=purchase_category_id,
        store=store,
        purchase=purchase,
        purchase_date=purchase_date,
    )

    if manual_multiplier is not None:
        multiplier = to_decimal(manual_multiplier)
        value = multiplier
        reward_type = "points"
        selected_rule = None
        calculation_source = "manual_override"
        reward_program_id = default_reward_program_id(db, card)
    elif selected_rule is not None:
        multiplier = to_decimal(selected_rule.multiplier)
        value = to_decimal(selected_rule.value if selected_rule.value is not None else multiplier)
        reward_type = normalize_reward_type(selected_rule.reward_type)
        calculation_source = rule_source
        reward_program_id = selected_rule.reward_program_id or default_reward_program_id(db, card)
    elif card.rewards_rate is not None:
        multiplier = to_decimal(card.rewards_rate)
        value = multiplier
        reward_type = "points"
        calculation_source = "card_default_rate"
        reward_program_id = default_reward_program_id(db, card)
    else:
        multiplier = Decimal("1")
        value = multiplier
        reward_type = "points"
        calculation_source = "fallback_1x"
        reward_program_id = default_reward_program_id(db, card)

    return {
        "merchant": purchase.store_name,
        "merchant_type": store.merchant_type if store else None,
        "merchant_category": store.merchant_category if store else None,
        "spending_category_id": purchase_category_id,
        "spending_category_name": category.name if category else None,
        "matched_rule": serialize_rule_summary(db, selected_rule),
        "fallback_rule": None,
        "selected_rule": serialize_rule_summary(db, selected_rule),
        "matched_rule_id": selected_rule.id if selected_rule else None,
        "reward_type": reward_type,
        "final_multiplier": multiplier,
        "rule_value": value,
        "priority": selected_rule.priority if selected_rule else None,
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
        f"merchant_type={resolution.get('merchant_type') or '-'}; "
        f"category={resolution['spending_category_name'] or 'Uncategorized'}; "
        f"matched_rule={resolution['matched_rule']['category_name'] if resolution['matched_rule'] else '-'}; "
        f"reward_type={resolution.get('reward_type') or 'points'}; "
        f"final_multiplier={format_multiplier(resolution['final_multiplier'])}x; "
        f"value={format_multiplier(to_decimal(resolution.get('rule_value')))}"
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
        reward_type = resolution["reward_type"]
        rule_value = resolution["rule_value"]
        reward_program_id = resolution["reward_program_id"] or payment.reward_program_id
        reward_components = calculate_reward_components(
            purchase=purchase,
            amount=to_decimal(payment.amount),
            reward_type=reward_type,
            multiplier=multiplier,
            value=rule_value,
        )
        calculation_source = resolution["calculation_source"]

        transaction = CreditCardRewardTransaction(
            purchase_id=purchase_id,
            credit_card_id=card.id,
            player_id=purchase.player_id or card.player_id,
            reward_program_id=reward_program_id,
            spending_category_id=transaction_category_id,
            matched_rule_id=resolution["matched_rule_id"],
            purchase_date=purchase_date,
            qualifying_spend=payment.amount,
            multiplier=multiplier,
            rewards_earned=reward_components["rewards_earned"],
            reward_type=reward_type,
            points_earned=reward_components["points_earned"],
            cashback_amount=reward_components["cashback_amount"],
            statement_credit_amount=reward_components["statement_credit_amount"],
            purchase_discount_amount=reward_components["purchase_discount_amount"],
            effective_savings_amount=reward_components["effective_savings_amount"],
            priority=resolution["priority"],
            calculation_source=calculation_source,
            credit_card_product_snapshot=card.nickname,
            notes=reward_resolution_note(payment.notes, resolution),
        )
        db.add(transaction)
        transactions.append(transaction)

        payment.spending_category_id = transaction_category_id
        payment.reward_program_id = reward_program_id
        payment.matched_rule_id = resolution["matched_rule_id"]
        payment.reward_multiplier = multiplier
        payment.applied_multiplier = multiplier
        payment.estimated_rewards_earned = reward_components["rewards_earned"]
        payment.calculated_rewards = reward_components["rewards_earned"]
        payment.reward_type = reward_type
        payment.points_earned = reward_components["points_earned"]
        payment.cashback_amount = reward_components["cashback_amount"]
        payment.statement_credit_amount = reward_components["statement_credit_amount"]
        payment.purchase_discount_amount = reward_components["purchase_discount_amount"]
        payment.effective_savings_amount = reward_components["effective_savings_amount"]
        payment.priority = resolution["priority"]
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
        matched_rule_id=None,
        purchase_date=purchase_date_only(purchase),
        qualifying_spend=qualifying_spend,
        multiplier=multiplier,
        rewards_earned=rewards_earned,
        reward_type="points",
        points_earned=rewards_earned,
        cashback_amount=Decimal("0"),
        statement_credit_amount=Decimal("0"),
        purchase_discount_amount=Decimal("0"),
        effective_savings_amount=Decimal("0"),
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
        "reward_type": transaction.reward_type,
        "points_earned": transaction.points_earned,
        "cashback_amount": transaction.cashback_amount,
        "statement_credit_amount": transaction.statement_credit_amount,
        "purchase_discount_amount": transaction.purchase_discount_amount,
        "effective_savings_amount": transaction.effective_savings_amount,
        "matched_rule_id": transaction.matched_rule_id,
        "priority": transaction.priority,
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
