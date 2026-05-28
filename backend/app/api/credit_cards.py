from calendar import monthrange
from datetime import date, datetime, timedelta
from app.utils.pydantic import model_fields_set as get_model_fields_set
from app.utils.time import utc_now
from decimal import Decimal
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session

from app.db.session import SessionLocal
from app.models.app_setting import AppSetting
from app.models.card_issuer import CardIssuer
from app.models.card_network import CardNetwork
from app.models.credit_card import CreditCard
from app.models.credit_card_product_change import CreditCardProductChange
from app.models.credit_card_reward_rule import CreditCardRewardRule
from app.models.credit_card_reward_transaction import CreditCardRewardTransaction
from app.models.player import Player
from app.models.reward_program import RewardProgram
from app.models.spending_category import SpendingCategory
from app.models.store import Store
from app.services.credit_card_rewards import normalize_reward_type, recalculate_rewards_for_credit_card


router = APIRouter(prefix="/credit-cards", tags=["credit-cards"])
logger = logging.getLogger(__name__)

REWARDS_TYPES = {"CASHBACK", "MR", "UR", "TY", "MILES", "OTHER"}
NETWORK_VALUES = {
    "visa": "Visa",
    "mastercard": "Mastercard",
    "master_card": "Mastercard",
    "mc": "Mastercard",
    "american_express": "American Express",
    "amex": "American Express",
    "discover": "Discover",
    "other": "Other",
}
MULTI_PLAYER_MODE_KEY = "multi_player_mode_enabled"


class CreditCardCreate(BaseModel):
    player_id: int | None = None
    issuer_id: int | None = None
    network_id: int | None = None
    reward_program_id: int | None = None
    nickname: str
    issuer: str | None = None
    network: str | None = None
    last_four: str | None = None
    credit_limit: Decimal | None = None
    current_balance: Decimal | None = None
    statement_balance: Decimal | None = None
    statement_paid_amount: Decimal | None = None
    available_credit: Decimal | None = None
    reported_utilization: Decimal | None = None
    minimum_payment_due: Decimal | None = None
    minimum_payment_paid: bool = False
    autopay_enabled: bool = False
    payment_due_date: date | None = None
    next_statement_close_date: date | None = None
    preferred_utilization: Decimal | None = None
    apr: Decimal | None = None
    payment_options: str | None = None
    statement_close_day: int | None = None
    payment_due_day: int | None = None
    opened_date: date | None = None
    date_last_used: date | None = None
    date_last_product_change: date | None = None
    date_closed: date | None = None
    date_last_cli: date | None = None
    annual_fee: Decimal | None = None
    signup_bonus_points: int | None = None
    signup_bonus_spend: Decimal | None = None
    signup_bonus_deadline: date | None = None
    current_spend_progress: Decimal = Decimal("0")
    rewards_type: str = "OTHER"
    rewards_rate: Decimal | None = None
    category_tags: str | None = None
    is_active: bool = True
    reports_to_ex: bool = False
    reports_to_tu: bool = False
    reports_to_eq: bool = False
    notes: str | None = None

    @field_validator("credit_limit")
    @classmethod
    def validate_credit_limit(cls, value: Decimal | None) -> Decimal | None:
        return validate_credit_limit_amount(value)

    @field_validator("statement_close_day", "payment_due_day")
    @classmethod
    def validate_billing_day(cls, value: int | None) -> int | None:
        return validate_billing_day_value(value)


class CreditCardUpdate(BaseModel):
    player_id: int | None = None
    issuer_id: int | None = None
    network_id: int | None = None
    reward_program_id: int | None = None
    nickname: str | None = None
    issuer: str | None = None
    network: str | None = None
    last_four: str | None = None
    credit_limit: Decimal | None = None
    current_balance: Decimal | None = None
    statement_balance: Decimal | None = None
    statement_paid_amount: Decimal | None = None
    available_credit: Decimal | None = None
    reported_utilization: Decimal | None = None
    minimum_payment_due: Decimal | None = None
    minimum_payment_paid: bool | None = None
    autopay_enabled: bool | None = None
    payment_due_date: date | None = None
    next_statement_close_date: date | None = None
    preferred_utilization: Decimal | None = None
    apr: Decimal | None = None
    payment_options: str | None = None
    statement_close_day: int | None = None
    payment_due_day: int | None = None
    opened_date: date | None = None
    date_last_used: date | None = None
    date_last_product_change: date | None = None
    date_closed: date | None = None
    date_last_cli: date | None = None
    annual_fee: Decimal | None = None
    signup_bonus_points: int | None = None
    signup_bonus_spend: Decimal | None = None
    signup_bonus_deadline: date | None = None
    current_spend_progress: Decimal | None = None
    rewards_type: str | None = None
    rewards_rate: Decimal | None = None
    category_tags: str | None = None
    is_active: bool | None = None
    reports_to_ex: bool | None = None
    reports_to_tu: bool | None = None
    reports_to_eq: bool | None = None
    notes: str | None = None

    @field_validator("credit_limit")
    @classmethod
    def validate_credit_limit(cls, value: Decimal | None) -> Decimal | None:
        return validate_credit_limit_amount(value)

    @field_validator("statement_close_day", "payment_due_day")
    @classmethod
    def validate_billing_day(cls, value: int | None) -> int | None:
        return validate_billing_day_value(value)


class RewardRuleCreate(BaseModel):
    spending_category_id: int
    reward_type: str = "points"
    multiplier: Decimal | None = None
    value: Decimal | None = None
    merchant_type: str | None = None
    store_id: int | None = None
    priority: int = 100
    reward_program_id: int | None = None
    effective_start_date: date | None = None
    active: bool = True
    notes: str | None = None


class RewardRuleUpdate(BaseModel):
    spending_category_id: int | None = None
    reward_type: str | None = None
    multiplier: Decimal | None = None
    value: Decimal | None = None
    merchant_type: str | None = None
    store_id: int | None = None
    priority: int | None = None
    reward_program_id: int | None = None
    effective_start_date: date | None = None
    effective_end_date: date | None = None
    active: bool | None = None
    notes: str | None = None


class ProductChangeCreate(BaseModel):
    previous_product_name: str | None = None
    new_product_name: str
    effective_date: date
    notes: str | None = None


def get_payload_fields(payload: BaseModel) -> set[str]:
    return get_model_fields_set(payload)


def validate_credit_limit_amount(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None

    if value < 0:
        raise ValueError("Credit limit must be a non-negative whole-dollar amount")

    if value != value.to_integral_value():
        raise ValueError("Credit limit must be a whole-dollar amount")

    return value


def validate_billing_day_value(value: int | None) -> int | None:
    if value is None:
        return None

    if value < 1 or value > 31:
        raise ValueError("Billing day must be between 1 and 31")

    return value


def resolve_configured_billing_day(year: int, month: int, configured_day: int) -> date:
    target_day = min(configured_day, monthrange(year, month)[1])
    return date(year, month, target_day)


def days_until_day(day: int | None) -> int | None:
    if day is None:
        return None

    today = date.today()
    target = resolve_configured_billing_day(today.year, today.month, day)

    if target < today:
        next_month = today.month + 1
        next_year = today.year

        if next_month == 13:
            next_month = 1
            next_year += 1

        target = resolve_configured_billing_day(next_year, next_month, day)

    return (target - today).days


def days_until_date(value: date | None) -> int | None:
    if value is None:
        return None

    return (value - date.today()).days


def serialize_card(card: CreditCard) -> dict:
    credit_limit = Decimal(card.credit_limit) if card.credit_limit is not None else None
    current_balance = Decimal(card.current_balance or 0)
    statement_balance = Decimal(card.statement_balance or 0)
    statement_paid_amount = Decimal(card.statement_paid_amount or 0)
    statement_remaining = max(Decimal("0"), statement_balance - statement_paid_amount)
    minimum_payment_due = Decimal(card.minimum_payment_due or 0)
    available_credit = (
        Decimal(card.available_credit)
        if card.available_credit is not None
        else (
            credit_limit - current_balance
            if credit_limit is not None
            else None
        )
    )
    signup_bonus_spend = card.signup_bonus_spend
    current_spend_progress = Decimal(card.current_spend_progress or 0)
    utilization = (
        float((current_balance / credit_limit) * 100)
        if credit_limit is not None and credit_limit > 0
        else None
    )
    msr_remaining = (
        max(Decimal("0"), Decimal(signup_bonus_spend) - current_spend_progress)
        if signup_bonus_spend is not None
        else None
    )
    preferred_balance = (
        credit_limit * (Decimal(card.preferred_utilization) / Decimal("100"))
        if (
            card.preferred_utilization is not None
            and credit_limit is not None
            and credit_limit > 0
        )
        else None
    )
    payment_needed_for_preferred_utilization = (
        max(Decimal("0"), current_balance - preferred_balance)
        if preferred_balance is not None
        else None
    )
    estimated_monthly_interest = (
        (current_balance * (Decimal(card.apr) / Decimal("100")) / Decimal("12"))
        if card.apr is not None
        else None
    )

    db = object_session(card)
    reward_rules = (
        db
        .query(CreditCardRewardRule, SpendingCategory)
        .join(
            SpendingCategory,
            SpendingCategory.id == CreditCardRewardRule.spending_category_id,
        )
        .filter(CreditCardRewardRule.credit_card_id == card.id)
        .order_by(
            CreditCardRewardRule.active.desc(),
            CreditCardRewardRule.effective_start_date.desc(),
            CreditCardRewardRule.multiplier.desc(),
            SpendingCategory.name.asc(),
        )
        .all()
        if db
        else []
    )
    product_changes = (
        db.query(CreditCardProductChange)
        .filter(CreditCardProductChange.credit_card_id == card.id)
        .order_by(CreditCardProductChange.effective_date.desc())
        .all()
        if db
        else []
    )
    player = (
        db.query(Player).filter(Player.id == card.player_id).first()
        if db and card.player_id
        else None
    )
    reward_program = (
        db.query(RewardProgram).filter(RewardProgram.id == card.reward_program_id).first()
        if db and card.reward_program_id
        else None
    )
    issuer_ref = (
        db.query(CardIssuer).filter(CardIssuer.id == card.issuer_id).first()
        if db and card.issuer_id
        else None
    )
    network_ref = (
        db.query(CardNetwork).filter(CardNetwork.id == card.network_id).first()
        if db and card.network_id
        else None
    )
    reward_transactions = (
        db.query(CreditCardRewardTransaction)
        .filter(CreditCardRewardTransaction.credit_card_id == card.id)
        .order_by(CreditCardRewardTransaction.purchase_date.desc(), CreditCardRewardTransaction.id.desc())
        .limit(25)
        .all()
        if db
        else []
    )
    today = date.today()
    month_start = today.replace(day=1)
    ytd_start = today.replace(month=1, day=1)
    rewards_all_time = (
        db.query(CreditCardRewardTransaction)
        .filter(CreditCardRewardTransaction.credit_card_id == card.id)
        .all()
        if db
        else []
    )
    rewards_current_month = sum(
        Decimal(transaction.rewards_earned)
        for transaction in rewards_all_time
        if transaction.purchase_date >= month_start
    )
    rewards_ytd = sum(
        Decimal(transaction.rewards_earned)
        for transaction in rewards_all_time
        if transaction.purchase_date >= ytd_start
    )
    rewards_all_time_total = sum(
        Decimal(transaction.rewards_earned) for transaction in rewards_all_time
    )

    return {
        "id": card.id,
        "player_id": card.player_id,
        "issuer_id": card.issuer_id,
        "issuer_ref": (
            {
                "id": issuer_ref.id,
                "name": issuer_ref.name,
                "short_name": issuer_ref.short_name,
                "active": issuer_ref.active,
                "issuer_type": issuer_ref.issuer_type,
            }
            if issuer_ref
            else None
        ),
        "network_id": card.network_id,
        "network_ref": (
            {
                "id": network_ref.id,
                "name": network_ref.name,
                "code": network_ref.code,
                "active": network_ref.active,
            }
            if network_ref
            else None
        ),
        "player": (
            {
                "id": player.id,
                "label": player.label,
                "name": player.name,
                "active": player.active,
            }
            if player
            else None
        ),
        "reward_program_id": card.reward_program_id,
        "reward_program": (
            {
                "id": reward_program.id,
                "name": reward_program.name,
                "short_code": reward_program.short_code,
                "category": reward_program.category,
                "estimated_value_cents_per_point": reward_program.estimated_value_cents_per_point,
                "active": reward_program.active,
            }
            if reward_program
            else None
        ),
        "nickname": card.nickname,
        "issuer": card.issuer,
        "network": card.network,
        "last_four": card.last_four,
        "credit_limit": card.credit_limit,
        "current_balance": card.current_balance,
        "statement_balance": card.statement_balance,
        "statement_paid_amount": card.statement_paid_amount,
        "statement_remaining": statement_remaining,
        "available_credit": card.available_credit,
        "calculated_available_credit": available_credit,
        "reported_utilization": card.reported_utilization,
        "minimum_payment_due": card.minimum_payment_due,
        "minimum_payment_paid": card.minimum_payment_paid,
        "autopay_enabled": card.autopay_enabled,
        "interest_risk": statement_remaining > 0,
        "minimum_payment_missing": minimum_payment_due > 0 and not card.minimum_payment_paid,
        "payment_due_date": card.payment_due_date,
        "next_statement_close_date": card.next_statement_close_date,
        "preferred_utilization": card.preferred_utilization,
        "payment_needed_for_preferred_utilization": payment_needed_for_preferred_utilization,
        "apr": card.apr,
        "estimated_monthly_interest": estimated_monthly_interest,
        "payment_options": card.payment_options,
        "statement_close_day": card.statement_close_day,
        "payment_due_day": card.payment_due_day,
        "opened_date": card.opened_date,
        "date_last_used": card.date_last_used,
        "date_last_product_change": card.date_last_product_change,
        "date_closed": card.date_closed,
        "date_last_cli": card.date_last_cli,
        "annual_fee": card.annual_fee,
        "signup_bonus_points": card.signup_bonus_points,
        "signup_bonus_spend": card.signup_bonus_spend,
        "signup_bonus_deadline": card.signup_bonus_deadline,
        "current_spend_progress": card.current_spend_progress,
        "rewards_type": card.rewards_type,
        "rewards_rate": card.rewards_rate,
        "reward_rules": [
            {
                "id": rule.id,
                "credit_card_id": rule.credit_card_id,
                "spending_category_id": rule.spending_category_id,
                "store_id": rule.store_id,
                "reward_program_id": rule.reward_program_id,
                "reward_type": rule.reward_type,
                "merchant_type": rule.merchant_type,
                "multiplier": rule.multiplier,
                "value": rule.value,
                "priority": rule.priority,
                "effective_start_date": rule.effective_start_date,
                "effective_end_date": rule.effective_end_date,
                "active": rule.active,
                "notes": rule.notes,
                "spending_category": {
                    "id": category.id,
                    "key": category.key,
                    "name": category.name,
                },
                "reward_program": (
                    {
                        "id": rule_program.id,
                        "name": rule_program.name,
                        "short_code": rule_program.short_code,
                        "category": rule_program.category,
                        "active": rule_program.active,
                    }
                    if (
                        rule.reward_program_id is not None
                        and (
                            rule_program := db.query(RewardProgram)
                            .filter(RewardProgram.id == rule.reward_program_id)
                            .first()
                        )
                    )
                    else None
                ),
                "store": (
                    {
                        "id": rule_store.id,
                        "name": rule_store.name,
                        "merchant_type": rule_store.merchant_type,
                        "merchant_category": rule_store.merchant_category,
                    }
                    if (
                        rule.store_id is not None
                        and (
                            rule_store := db.query(Store)
                            .filter(Store.id == rule.store_id)
                            .first()
                        )
                    )
                    else None
                ),
            }
            for rule, category in reward_rules
        ],
        "product_changes": [
            {
                "id": change.id,
                "credit_card_id": change.credit_card_id,
                "previous_product_name": change.previous_product_name,
                "new_product_name": change.new_product_name,
                "effective_date": change.effective_date,
                "notes": change.notes,
                "created_at": change.created_at,
            }
            for change in product_changes
        ],
        "category_tags": card.category_tags,
        "is_active": card.is_active,
        "reports_to_ex": card.reports_to_ex,
        "reports_to_tu": card.reports_to_tu,
        "reports_to_eq": card.reports_to_eq,
        "notes": card.notes,
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "utilization_percent": utilization,
        "msr_remaining": msr_remaining,
        "days_until_statement_close": (
            days_until_date(card.next_statement_close_date)
            if card.next_statement_close_date
            else days_until_day(card.statement_close_day)
        ),
        "days_until_payment_due": (
            days_until_date(card.payment_due_date)
            if card.payment_due_date
            else days_until_day(card.payment_due_day)
        ),
        "rewards_earned": {
            "current_month": rewards_current_month,
            "ytd": rewards_ytd,
            "all_time": rewards_all_time_total,
        },
        "reward_transactions": [
            {
                "id": transaction.id,
                "purchase_id": transaction.purchase_id,
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
                "calculation_source": transaction.calculation_source,
                "notes": transaction.notes,
            }
            for transaction in reward_transactions
        ],
    }


def validate_rewards_type(value: str) -> str:
    normalized = value.strip().upper()

    if normalized not in REWARDS_TYPES:
        raise HTTPException(status_code=400, detail="Invalid rewards_type")

    return normalized


def normalize_network_value(value: str | None) -> str | None:
    if value is None:
        return None

    key = value.strip().lower().replace(" ", "_").replace("-", "_")
    if not key:
        return None

    if key not in NETWORK_VALUES:
        logger.warning("Invalid credit card network value received: %s", value)
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_card_network",
                "allowed_values": sorted(set(NETWORK_VALUES.values())),
                "received": value,
            },
        )

    return NETWORK_VALUES[key]


def ensure_unique_card_nickname(
    db: Session,
    nickname: str,
    *,
    excluding_card_id: int | None = None,
) -> None:
    query = db.query(CreditCard).filter(CreditCard.nickname.ilike(nickname.strip()))

    if excluding_card_id is not None:
        query = query.filter(CreditCard.id != excluding_card_id)

    if query.first():
        logger.warning("Duplicate credit card nickname rejected: %s", nickname)
        raise HTTPException(
            status_code=409,
            detail={
                "error": "duplicate_credit_card_nickname",
                "message": f"Credit card '{nickname}' already exists.",
            },
        )


def get_bool_setting(db: Session, key: str, default: bool = False) -> bool:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()

    if not setting or setting.value is None:
        return default

    return setting.value.lower() in {"1", "true", "yes", "on"}


def active_players(db: Session) -> list[Player]:
    return (
        db.query(Player)
        .filter(Player.active.is_(True))
        .order_by(Player.label.asc(), Player.id.asc())
        .all()
    )


def default_player_id_for_create(db: Session, player_id: int | None) -> int | None:
    if player_id is not None:
        validate_player(db, player_id)
        return player_id

    if not get_bool_setting(db, MULTI_PLAYER_MODE_KEY, False):
        return None

    players = active_players(db)

    if len(players) == 1:
        return players[0].id

    if len(players) > 1:
        raise HTTPException(
            status_code=400,
            detail="Select a player for this card.",
        )

    return None


def validate_player(
    db: Session,
    player_id: int | None,
    current_player_id: int | None = None,
) -> None:
    if player_id is None:
        return

    player = db.query(Player).filter(Player.id == player_id).first()

    if not player:
        raise HTTPException(status_code=400, detail="Player not found")

    if not player.active and player_id != current_player_id:
        raise HTTPException(status_code=400, detail="Player is inactive")


def validate_reward_program(db: Session, reward_program_id: int | None) -> None:
    if reward_program_id is None:
        return

    program = (
        db.query(RewardProgram)
        .filter(RewardProgram.id == reward_program_id)
        .first()
    )

    if not program:
        raise HTTPException(status_code=400, detail="Reward program not found")


def validate_issuer(db: Session, issuer_id: int | None, current_issuer_id: int | None = None) -> CardIssuer | None:
    if issuer_id is None:
        return None

    issuer = db.query(CardIssuer).filter(CardIssuer.id == issuer_id).first()

    if not issuer:
        raise HTTPException(status_code=400, detail="Card issuer not found")

    if not issuer.active and issuer_id != current_issuer_id:
        raise HTTPException(status_code=400, detail="Card issuer is inactive")

    return issuer


def validate_network(db: Session, network_id: int | None, current_network_id: int | None = None) -> CardNetwork | None:
    if network_id is None:
        return None

    network = db.query(CardNetwork).filter(CardNetwork.id == network_id).first()

    if not network:
        raise HTTPException(status_code=400, detail="Card network not found")

    if not network.active and network_id != current_network_id:
        raise HTTPException(status_code=400, detail="Card network is inactive")

    return network


def validate_store(db: Session, store_id: int | None) -> Store | None:
    if store_id is None:
        return None

    store = db.query(Store).filter(Store.id == store_id).first()

    if not store:
        raise HTTPException(status_code=400, detail="Store not found")

    return store


def default_reward_program_id(card: CreditCard, reward_program_id: int | None) -> int | None:
    return reward_program_id if reward_program_id is not None else card.reward_program_id


def normalized_rule_numbers(
    reward_type: str,
    multiplier: Decimal | None,
    value: Decimal | None,
) -> tuple[Decimal, Decimal | None]:
    normalized_type = normalize_reward_type(reward_type)

    if normalized_type == "points":
        resolved_multiplier = multiplier if multiplier is not None else value
        if resolved_multiplier is None:
            raise HTTPException(status_code=400, detail="Point reward rules require a multiplier")
        return resolved_multiplier, value if value is not None else resolved_multiplier

    resolved_value = value if value is not None else multiplier
    if resolved_value is None:
        raise HTTPException(
            status_code=400,
            detail=f"{normalized_type} reward rules require a value",
        )

    return Decimal("0"), resolved_value


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
        payload_data = getattr(payload, "model_dump", payload.dict)()
        payload_data["nickname"] = payload.nickname.strip()
        if not payload_data["nickname"]:
            logger.warning("Credit card create rejected: missing nickname")
            raise HTTPException(status_code=400, detail="Nickname is required")
        ensure_unique_card_nickname(db, payload_data["nickname"])
        payload_data["player_id"] = default_player_id_for_create(
            db,
            payload.player_id,
        )
        validate_reward_program(db, payload.reward_program_id)
        issuer = validate_issuer(db, payload.issuer_id)
        network = validate_network(db, payload.network_id)
        if not network:
            payload_data["network"] = normalize_network_value(payload.network)
        if issuer is None and not payload.issuer:
            logger.warning("Credit card create rejected: missing issuer")
            raise HTTPException(status_code=400, detail="Select a card issuer")
        if issuer is None:
            payload_data["issuer"] = payload.issuer.strip()
        card = CreditCard(
            **payload_data
        )
        if issuer:
            card.issuer = issuer.name
        if network:
            card.network = network.name
        card.rewards_type = validate_rewards_type(payload.rewards_type)
        db.add(card)
        db.commit()
        db.refresh(card)
        return serialize_card(card)
    except IntegrityError as exc:
        db.rollback()
        logger.exception("Credit card create failed during persistence")
        raise HTTPException(
            status_code=400,
            detail={
                "error": "credit_card_persistence_failed",
                "message": str(exc.orig),
            },
        ) from exc
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

            if field == "nickname" and value is not None:
                value = value.strip()
                if not value:
                    raise HTTPException(status_code=400, detail="Nickname is required")
                ensure_unique_card_nickname(db, value, excluding_card_id=card.id)

            if field == "player_id":
                validate_player(db, value, card.player_id)

            if field == "reward_program_id":
                validate_reward_program(db, value)

            if field == "issuer_id":
                issuer = validate_issuer(db, value, card.issuer_id)
                card.issuer_id = value
                if issuer:
                    card.issuer = issuer.name
                elif value is None:
                    card.issuer_id = None
                continue

            if field == "network_id":
                network = validate_network(db, value, card.network_id)
                card.network = network.name if network else None
                card.network_id = value
                continue

            if field == "network":
                value = normalize_network_value(value)

            setattr(card, field, value)

        card.updated_at = utc_now()
        db.commit()
        db.refresh(card)
        return serialize_card(card)
    except IntegrityError as exc:
        db.rollback()
        logger.exception("Credit card update failed during persistence")
        raise HTTPException(
            status_code=400,
            detail={
                "error": "credit_card_persistence_failed",
                "message": str(exc.orig),
            },
        ) from exc
    finally:
        db.close()


def validate_reward_rule(
    db: Session,
    credit_card_id: int,
    spending_category_id: int,
) -> tuple[CreditCard, SpendingCategory]:
    card = db.query(CreditCard).filter(CreditCard.id == credit_card_id).first()

    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    category = (
        db.query(SpendingCategory)
        .filter(SpendingCategory.id == spending_category_id)
        .first()
    )

    if not category:
        raise HTTPException(status_code=404, detail="Spending category not found")

    return card, category


def serialize_reward_rule(
    db: Session,
    rule: CreditCardRewardRule,
    category: SpendingCategory,
) -> dict:
    reward_program = (
        db.query(RewardProgram)
        .filter(RewardProgram.id == rule.reward_program_id)
        .first()
        if rule.reward_program_id is not None
        else None
    )
    store = (
        db.query(Store).filter(Store.id == rule.store_id).first()
        if rule.store_id is not None
        else None
    )

    return {
        "id": rule.id,
        "credit_card_id": rule.credit_card_id,
        "spending_category_id": rule.spending_category_id,
        "store_id": rule.store_id,
        "reward_program_id": rule.reward_program_id,
        "reward_type": rule.reward_type,
        "merchant_type": rule.merchant_type,
        "multiplier": rule.multiplier,
        "value": rule.value,
        "priority": rule.priority,
        "effective_start_date": rule.effective_start_date,
        "effective_end_date": rule.effective_end_date,
        "active": rule.active,
        "notes": rule.notes,
        "created_at": rule.created_at,
        "spending_category": {
            "id": category.id,
            "key": category.key,
            "name": category.name,
        },
        "reward_program": (
            {
                "id": reward_program.id,
                "name": reward_program.name,
                "short_code": reward_program.short_code,
                "category": reward_program.category,
                "active": reward_program.active,
            }
            if reward_program
            else None
        ),
        "store": (
            {
                "id": store.id,
                "name": store.name,
                "merchant_type": store.merchant_type,
                "merchant_category": store.merchant_category,
            }
            if store
            else None
        ),
    }


@router.get("/{card_id}/reward-rules")
def list_reward_rules(card_id: int):
    db: Session = SessionLocal()

    try:
        card = db.query(CreditCard).filter(CreditCard.id == card_id).first()

        if not card:
            raise HTTPException(status_code=404, detail="Credit card not found")

        rules = (
            db.query(CreditCardRewardRule, SpendingCategory)
            .join(
                SpendingCategory,
                SpendingCategory.id == CreditCardRewardRule.spending_category_id,
            )
            .filter(CreditCardRewardRule.credit_card_id == card_id)
            .order_by(CreditCardRewardRule.multiplier.desc(), SpendingCategory.name.asc())
            .all()
        )
        return [serialize_reward_rule(db, rule, category) for rule, category in rules]
    finally:
        db.close()


@router.post("/{card_id}/reward-rules")
def create_reward_rule(card_id: int, payload: RewardRuleCreate):
    db: Session = SessionLocal()

    try:
        card, category = validate_reward_rule(
            db,
            card_id,
            payload.spending_category_id,
        )
        reward_type = normalize_reward_type(payload.reward_type)
        multiplier, value = normalized_rule_numbers(
            reward_type,
            payload.multiplier,
            payload.value,
        )
        merchant_type = payload.merchant_type.strip().lower() if payload.merchant_type else None
        validate_store(db, payload.store_id)
        reward_program_id = default_reward_program_id(
            card,
            payload.reward_program_id,
        )
        if reward_type == "points":
            validate_reward_program(db, reward_program_id)
        elif payload.reward_program_id is not None:
            validate_reward_program(db, payload.reward_program_id)
        existing_rule = (
            db.query(CreditCardRewardRule)
            .filter(CreditCardRewardRule.credit_card_id == card_id)
            .filter(
                CreditCardRewardRule.spending_category_id
                == payload.spending_category_id
            )
            .filter(CreditCardRewardRule.store_id == payload.store_id)
            .filter(CreditCardRewardRule.merchant_type == merchant_type)
            .filter(CreditCardRewardRule.reward_type == reward_type)
            .first()
        )

        if existing_rule:
            raise HTTPException(
                status_code=400,
                detail="Reward rule already exists for this category and merchant target",
            )

        rule = CreditCardRewardRule(
            credit_card_id=card_id,
            spending_category_id=payload.spending_category_id,
            store_id=payload.store_id,
            reward_program_id=reward_program_id if reward_type == "points" else payload.reward_program_id,
            reward_type=reward_type,
            merchant_type=merchant_type,
            multiplier=multiplier,
            value=value,
            priority=payload.priority,
            effective_start_date=payload.effective_start_date or date.today(),
            active=payload.active,
            notes=payload.notes,
        )
        db.add(rule)
        db.flush()
        affected_purchase_count = recalculate_rewards_for_credit_card(db, card_id)
        db.commit()
        db.refresh(rule)
        response = serialize_reward_rule(db, rule, category)
        response["recalculated_purchase_count"] = affected_purchase_count
        return response
    finally:
        db.close()


@router.patch("/reward-rules/{rule_id}")
def update_reward_rule(rule_id: int, payload: RewardRuleUpdate):
    db: Session = SessionLocal()

    try:
        rule = (
            db.query(CreditCardRewardRule)
            .filter(CreditCardRewardRule.id == rule_id)
            .first()
        )

        if not rule:
            raise HTTPException(status_code=404, detail="Reward rule not found")

        fields = get_payload_fields(payload)

        if "spending_category_id" in fields and payload.spending_category_id is not None:
            card, category = validate_reward_rule(
                db,
                rule.credit_card_id,
                payload.spending_category_id,
            )
        else:
            card = db.query(CreditCard).filter(CreditCard.id == rule.credit_card_id).first()
            category = (
                db.query(SpendingCategory)
                .filter(SpendingCategory.id == rule.spending_category_id)
                .first()
            )

        for field in fields:
            value = getattr(payload, field)

            if field == "reward_program_id":
                pending_reward_type = normalize_reward_type(
                    payload.reward_type
                    if "reward_type" in fields and payload.reward_type is not None
                    else rule.reward_type
                )
                if pending_reward_type == "points":
                    value = default_reward_program_id(card, value)
                    validate_reward_program(db, value)
                elif value is not None:
                    validate_reward_program(db, value)

            if field == "reward_type" and value is not None:
                value = normalize_reward_type(value)

            if field == "store_id":
                validate_store(db, value)

            if field == "merchant_type" and isinstance(value, str):
                value = value.strip().lower() or None

            setattr(rule, field, value)

        if {"reward_type", "multiplier", "value"} & fields:
            rule.reward_type = normalize_reward_type(rule.reward_type)
            multiplier, value = normalized_rule_numbers(
                rule.reward_type,
                rule.multiplier,
                rule.value,
            )
            rule.multiplier = multiplier
            rule.value = value

        affected_purchase_count = recalculate_rewards_for_credit_card(
            db,
            rule.credit_card_id,
        )
        db.commit()
        db.refresh(rule)

        if category is None:
            raise HTTPException(status_code=404, detail="Spending category not found")

        response = serialize_reward_rule(db, rule, category)
        response["recalculated_purchase_count"] = affected_purchase_count
        return response
    finally:
        db.close()


@router.delete("/reward-rules/{rule_id}")
def delete_reward_rule(rule_id: int):
    db: Session = SessionLocal()

    try:
        rule = (
            db.query(CreditCardRewardRule)
            .filter(CreditCardRewardRule.id == rule_id)
            .first()
        )

        if not rule:
            raise HTTPException(status_code=404, detail="Reward rule not found")

        credit_card_id = rule.credit_card_id
        db.delete(rule)
        db.flush()
        affected_purchase_count = recalculate_rewards_for_credit_card(
            db,
            credit_card_id,
        )
        db.commit()
        return {
            "deleted": True,
            "recalculated_purchase_count": affected_purchase_count,
        }
    finally:
        db.close()


@router.post("/{card_id}/reward-transactions/recalculate")
def recalculate_credit_card_rewards(card_id: int):
    db: Session = SessionLocal()

    try:
        card = db.query(CreditCard).filter(CreditCard.id == card_id).first()

        if not card:
            raise HTTPException(status_code=404, detail="Credit card not found")

        affected_purchase_count = recalculate_rewards_for_credit_card(db, card_id)
        db.commit()
        return {
            "recalculated": True,
            "purchase_count": affected_purchase_count,
        }
    finally:
        db.close()


@router.post("/{card_id}/product-changes")
def record_product_change(card_id: int, payload: ProductChangeCreate):
    db: Session = SessionLocal()

    try:
        card = db.query(CreditCard).filter(CreditCard.id == card_id).first()

        if not card:
            raise HTTPException(status_code=404, detail="Credit card not found")

        existing_changes = (
            db.query(CreditCardProductChange)
            .filter(CreditCardProductChange.credit_card_id == card_id)
            .order_by(CreditCardProductChange.effective_date.desc())
            .all()
        )
        previous_product_name = (
            payload.previous_product_name.strip()
            if payload.previous_product_name and payload.previous_product_name.strip()
            else (
                existing_changes[0].new_product_name
                if existing_changes
                else card.nickname
            )
        )
        effective_end_date = payload.effective_date - timedelta(days=1)
        active_rules = (
            db.query(CreditCardRewardRule)
            .filter(CreditCardRewardRule.credit_card_id == card_id)
            .filter(CreditCardRewardRule.active.is_(True))
            .filter(CreditCardRewardRule.effective_end_date.is_(None))
            .all()
        )

        for rule in active_rules:
            rule.effective_end_date = effective_end_date
            rule.active = False

        for rule in active_rules:
            db.add(
                CreditCardRewardRule(
                    credit_card_id=card_id,
                    spending_category_id=rule.spending_category_id,
                    store_id=rule.store_id,
                    reward_program_id=rule.reward_program_id or card.reward_program_id,
                    reward_type=rule.reward_type,
                    merchant_type=rule.merchant_type,
                    multiplier=rule.multiplier,
                    value=rule.value,
                    priority=rule.priority,
                    effective_start_date=payload.effective_date,
                    active=True,
                    notes=(
                        f"Created from product change to {payload.new_product_name.strip()}"
                    ),
                )
            )

        change = CreditCardProductChange(
            credit_card_id=card_id,
            previous_product_name=previous_product_name,
            new_product_name=payload.new_product_name.strip(),
            effective_date=payload.effective_date,
            notes=payload.notes,
        )
        db.add(change)
        card.nickname = payload.new_product_name.strip()
        card.date_last_product_change = payload.effective_date
        card.updated_at = utc_now()
        recalculate_rewards_for_credit_card(db, card_id)
        db.commit()
        db.refresh(card)
        return serialize_card(card)
    finally:
        db.close()
