from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.buyer import Buyer
from app.models.credit_card import CreditCard
from app.models.credit_card_reward_transaction import CreditCardRewardTransaction
from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.models.player import Player
from app.models.purchase_batch import PurchaseBatch
from app.models.reward_program import RewardProgram
from app.models.sale import Sale
from app.models.spending_category import SpendingCategory
from app.services.operational_queues import (
    get_awaiting_payment_sales,
    get_purchases_needing_receipts,
    sale_expected_payment_date,
    sale_unpaid_expected_total,
)
from app.services.reward_program_defaults import ensure_default_reward_program_values


router = APIRouter(prefix="/dashboard", tags=["dashboard"])

INSTANT_DISCOUNT_REWARD_TYPES = {"instant_discount_percent", "purchase_discount"}


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    return Decimal(str(value))


def reward_program_valuation(
    program: RewardProgram | None,
    reward_amount,
) -> dict:
    if program is None:
        return {
            "estimated_value": Decimal("0"),
            "valuation_status": "not_configured",
            "value_unit": None,
        }

    value_unit = program.value_unit or "cents_per_point"
    configured_value = program.estimated_value_cents_per_point

    if value_unit == "variable":
        return {
            "estimated_value": Decimal("0"),
            "valuation_status": "variable",
            "value_unit": value_unit,
        }

    if configured_value is None:
        return {
            "estimated_value": Decimal("0"),
            "valuation_status": "not_configured",
            "value_unit": value_unit,
        }

    reward_decimal = to_decimal(reward_amount)
    configured_decimal = to_decimal(configured_value)
    if value_unit == "usd_per_token":
        estimated_value = reward_decimal * configured_decimal
    else:
        estimated_value = reward_decimal * configured_decimal / Decimal("100")

    return {
        "estimated_value": estimated_value,
        "valuation_status": "fixed",
        "value_unit": value_unit,
    }


def is_instant_discount_transaction(transaction: CreditCardRewardTransaction) -> bool:
    reward_type = (transaction.reward_type or "").lower()

    if reward_type in INSTANT_DISCOUNT_REWARD_TYPES:
        return True

    if to_decimal(getattr(transaction, "purchase_discount_amount", None)) > 0:
        return True

    return (
        to_decimal(getattr(transaction, "effective_savings_amount", None)) > 0
        and to_decimal(getattr(transaction, "rewards_earned", None)) == 0
        and to_decimal(getattr(transaction, "cashback_amount", None)) == 0
        and to_decimal(getattr(transaction, "statement_credit_amount", None)) == 0
    )


def instant_discount_saved_amount(transaction: CreditCardRewardTransaction) -> Decimal:
    purchase_discount = to_decimal(getattr(transaction, "purchase_discount_amount", None))

    if purchase_discount > 0:
        return purchase_discount

    return to_decimal(getattr(transaction, "effective_savings_amount", None))


def instant_discount_label(store_name: str, card: CreditCard | None) -> str:
    card_name = card.nickname if card else None

    if card_name:
        return f"{card_name} Discount"

    return f"{store_name} Instant Discount"


def add_instant_discount_metric(
    *,
    groups: dict[str, dict],
    details: list[dict],
    transaction: CreditCardRewardTransaction,
    purchase: PurchaseBatch | None,
    card: CreditCard | None,
    player: Player | None,
) -> None:
    saved_amount = instant_discount_saved_amount(transaction)
    qualifying_spend = to_decimal(transaction.qualifying_spend)
    store_name = purchase.store_name if purchase else "Unknown Store"
    group_key = f"{store_name}:{transaction.credit_card_id or 'unknown'}"
    group = groups.setdefault(
        group_key,
        {
            "label": instant_discount_label(store_name, card),
            "store_name": store_name,
            "credit_card_id": transaction.credit_card_id,
            "credit_card_nickname": card.nickname if card else None,
            "player_id": transaction.player_id,
            "player_label": player.label if player else None,
            "eligible_spend": Decimal("0"),
            "total_saved": Decimal("0"),
            "count": 0,
        },
    )
    group["eligible_spend"] += qualifying_spend
    group["total_saved"] += saved_amount
    group["count"] += 1
    details.append(
        {
            "transaction_id": transaction.id,
            "purchase_id": transaction.purchase_id,
            "store_name": store_name,
            "purchase_date": transaction.purchase_date,
            "credit_card_id": transaction.credit_card_id,
            "credit_card_nickname": card.nickname if card else None,
            "player_id": transaction.player_id,
            "player_label": player.label if player else None,
            "player_name": player.name if player else None,
            "eligible_spend": qualifying_spend,
            "saved_amount": saved_amount,
            "reward_type": transaction.reward_type,
            "matched_rule_id": transaction.matched_rule_id,
            "calculation_source": transaction.calculation_source,
        }
    )


def utilization_percent(card: CreditCard) -> float | None:
    credit_limit = to_decimal(card.credit_limit)

    if credit_limit <= 0:
        return None

    return float((to_decimal(card.current_balance) / credit_limit) * 100)


def fuel_account_points(db: Session, account_id: int, today: date) -> int:
    entries = (
        db.query(FuelPointEntry)
        .filter(FuelPointEntry.fuel_reward_account_id == account_id)
        .filter(FuelPointEntry.expires_on >= today)
        .all()
    )

    return sum(entry.points_earned for entry in entries)


def get_range_start(reporting_range: str, today: date) -> date | None:
    if reporting_range == "this_month":
        return today.replace(day=1)

    if reporting_range == "last_month":
        first_this_month = today.replace(day=1)
        last_month_end = first_this_month.fromordinal(first_this_month.toordinal() - 1)
        return last_month_end.replace(day=1)

    if reporting_range == "ytd":
        return today.replace(month=1, day=1)

    return None


def get_range_end(reporting_range: str, today: date) -> date | None:
    if reporting_range == "last_month":
        return today.replace(day=1)

    return None


def in_range(value: datetime | date | None, start: date | None, end: date | None) -> bool:
    if value is None:
        return False

    value_date = value.date() if isinstance(value, datetime) else value

    if start is not None and value_date < start:
        return False

    if end is not None and value_date >= end:
        return False

    return True


def sale_received_amount(sale: Sale) -> Decimal:
    return to_decimal(sale.payout_received)


def sale_in_reporting_range(sale: Sale, start: date | None, end: date | None) -> bool:
    return in_range(sale.sold_at, start, end)


def sale_financial_debug_row(
    sale: Sale,
    start: date | None,
    end: date | None,
) -> dict:
    is_voided = sale.status == "VOIDED"
    is_in_range = sale_in_reporting_range(sale, start, end)
    expected_payout = to_decimal(sale.expected_payout)
    received_amount = sale_received_amount(sale)
    included_in_gross_sales = not is_voided and is_in_range
    included_in_settled_revenue = (
        not is_voided
        and is_in_range
        and sale.status in {"COMPLETED", "SETTLED"}
        and received_amount > 0
    )
    included_in_receivables = (
        not is_voided
        and sale.status in {"ACTIVE", "SOLD_PENDING_PAYMENT", "PARTIALLY_SETTLED"}
        and expected_payout - received_amount > 0
    )

    if is_voided:
        reason = "excluded: voided"
    elif not is_in_range:
        reason = "excluded: outside reporting range"
    else:
        reason = "included: non-voided sale in reporting range"

    return {
        "sale_id": sale.id,
        "status": sale.status,
        "expected_payout": expected_payout,
        "received_amount": received_amount,
        "sold_date": sale.sold_at.date() if sale.sold_at else None,
        "included_in_gross_sales": included_in_gross_sales,
        "included_in_settled_revenue": included_in_settled_revenue,
        "included_in_outstanding_receivables": included_in_receivables,
        "included_excluded_reason": reason,
    }


def sale_financial_kpis(
    sales: list[Sale],
    start: date | None,
    end: date | None,
) -> dict:
    rows = [sale_financial_debug_row(sale, start, end) for sale in sales]

    gross_sales = sum(
        to_decimal(row["expected_payout"])
        for row in rows
        if row["included_in_gross_sales"]
    )
    settled_revenue = sum(
        to_decimal(row["received_amount"])
        for row in rows
        if row["included_in_settled_revenue"]
    )
    outstanding_receivables = sum(
        max(
            Decimal("0"),
            to_decimal(row["expected_payout"]) - to_decimal(row["received_amount"]),
        )
        for row in rows
        if row["included_in_outstanding_receivables"]
    )

    return {
        "gross_sales": gross_sales,
        "settled_revenue": settled_revenue,
        "outstanding_receivables": outstanding_receivables,
        "rows": rows,
    }


@router.get("/summary")
def dashboard_summary(range: str = "this_month", player_id: int | None = None):
    db: Session = SessionLocal()
    today = date.today()
    range_start = get_range_start(range, today)
    range_end = get_range_end(range, today)

    try:
        ensure_default_reward_program_values(db)
        db.commit()

        purchases_query = db.query(PurchaseBatch)
        credit_cards_query = db.query(CreditCard)

        if player_id is not None:
            purchases_query = purchases_query.filter(PurchaseBatch.player_id == player_id)
            credit_cards_query = credit_cards_query.filter(CreditCard.player_id == player_id)

        purchases = purchases_query.all()
        purchase_ids = {purchase.id for purchase in purchases}
        gift_cards_query = db.query(GiftCard)

        if player_id is not None:
            gift_cards_query = gift_cards_query.filter(
                GiftCard.purchase_batch_id.in_(purchase_ids or {-1})
            )

        gift_cards = gift_cards_query.all()
        sales = db.query(Sale).order_by(Sale.sold_at.desc(), Sale.id.desc()).all()
        range_sale_kpis = sale_financial_kpis(sales, range_start, range_end)
        fuel_accounts = db.query(FuelRewardAccount).all()
        credit_cards = credit_cards_query.all()
        purchase_count = len(purchases)
        reward_transactions_query = db.query(CreditCardRewardTransaction)

        if player_id is not None:
            reward_transactions_query = reward_transactions_query.filter(
                CreditCardRewardTransaction.player_id == player_id
            )

        reward_transactions = reward_transactions_query.all()
        spending_categories = {
            category.id: category
            for category in db.query(SpendingCategory).all()
        }
        reward_programs = {
            program.id: program
            for program in db.query(RewardProgram).all()
        }
        players = {
            player.id: player
            for player in db.query(Player).all()
        }
        purchases_by_id = {purchase.id: purchase for purchase in purchases}
        buyers = db.query(Buyer).all()
        ranged_purchases = [
            purchase
            for purchase in purchases
            if in_range(purchase.purchase_date, range_start, range_end)
        ]
        ranged_reward_transactions = [
            transaction
            for transaction in reward_transactions
            if in_range(transaction.purchase_date, range_start, range_end)
        ]
        ranged_settled_cards = [
            card
            for card in gift_cards
            if card.status == "SETTLED"
            and in_range(card.settlement_received_at, range_start, range_end)
        ]

        available_cards = [
            card for card in gift_cards if card.status == "VERIFIED_AVAILABLE"
        ]
        pending_verification_cards = [
            card for card in gift_cards if card.status == "NEEDS_VERIFICATION"
        ]
        awaiting_payment_cards = [
            card
            for card in gift_cards
            if card.status == "SOLD_PENDING_PAYMENT"
        ]
        settled_cards = [card for card in gift_cards if card.status == "SETTLED"]
        awaiting_payment_sales = get_awaiting_payment_sales(db)
        overdue_payment_sales = []

        for sale in awaiting_payment_sales:
            expected_payment_date = sale_expected_payment_date(db, sale)

            if expected_payment_date is not None and expected_payment_date < today:
                overdue_payment_sales.append(sale)

        purchases_needing_receipts = get_purchases_needing_receipts(db)

        fuel_points_available = 0
        fuel_accounts_near_target = []
        fuel_accounts_near_expiration = []

        for account in fuel_accounts:
            if account.status != "ACTIVE":
                continue

            current_points = fuel_account_points(db, account.id, today)
            fuel_points_available += current_points

            if (
                account.target_points is not None
                and current_points >= account.target_points - 2000
            ):
                fuel_accounts_near_target.append(
                    {
                        "id": account.id,
                        "retailer": account.retailer,
                        "current_points": current_points,
                        "target_points": account.target_points,
                    }
                )

            active_entries = (
                db.query(FuelPointEntry)
                .filter(FuelPointEntry.fuel_reward_account_id == account.id)
                .filter(FuelPointEntry.expires_on >= today)
                .order_by(FuelPointEntry.expires_on.asc())
                .all()
            )
            nearest_expiration = active_entries[0].expires_on if active_entries else None

            if nearest_expiration is not None:
                days_until_expiration = (nearest_expiration - today).days

                if days_until_expiration <= 14:
                    fuel_accounts_near_expiration.append(
                        {
                            "id": account.id,
                            "retailer": account.retailer,
                            "nearest_expiration_date": nearest_expiration,
                            "days_until_expiration": days_until_expiration,
                        }
                    )

        active_credit_cards = [card for card in credit_cards if card.is_active]
        high_utilization_cards = []

        for card in active_credit_cards:
            utilization = utilization_percent(card)

            if utilization is not None and utilization > 30:
                high_utilization_cards.append(
                    {
                        "id": card.id,
                        "nickname": card.nickname,
                        "issuer": card.issuer,
                        "current_balance": card.current_balance,
                        "credit_limit": card.credit_limit,
                        "utilization_percent": utilization,
                    }
                )

        settled_revenue = range_sale_kpis["settled_revenue"]
        realized_profit = sum(
            to_decimal(card.payout_received) - to_decimal(card.acquisition_cost)
            for card in settled_cards
            if card.payout_received is not None
        )
        buyer_reports = []

        for buyer in buyers:
            buyer_cards = [card for card in gift_cards if card.buyer_id == buyer.id]
            buyer_fuel_accounts = [
                account for account in fuel_accounts if account.buyer_id == buyer.id
            ]
            buyer_awaiting_cards = [
                card for card in buyer_cards if card.status == "SOLD_PENDING_PAYMENT"
            ]
            buyer_settled_cards = [
                card for card in buyer_cards if card.status == "SETTLED"
            ]
            buyer_overdue_cards = [
                card
                for card in buyer_awaiting_cards
                if card.expected_payment_date is not None
                and card.expected_payment_date < today
            ]
            buyer_volume = (
                sum(to_decimal(card.expected_payout) for card in buyer_cards)
                + sum(to_decimal(account.sale_price) for account in buyer_fuel_accounts)
            )
            buyer_profit = sum(
                to_decimal(card.payout_received) - to_decimal(card.acquisition_cost)
                for card in buyer_settled_cards
                if card.payout_received is not None
            )
            buyer_outstanding = sum(
                to_decimal(card.expected_payout) for card in buyer_awaiting_cards
            )

            buyer_reports.append(
                {
                    "id": buyer.id,
                    "name": buyer.name,
                    "total_sales_volume": buyer_volume,
                    "profit": buyer_profit,
                    "outstanding_payouts": buyer_outstanding,
                    "overdue_count": len(buyer_overdue_cards),
                }
            )

        top_buyer_by_volume = max(
            buyer_reports,
            key=lambda report: to_decimal(report["total_sales_volume"]),
            default=None,
        )
        highest_profit_buyer = max(
            buyer_reports,
            key=lambda report: to_decimal(report["profit"]),
            default=None,
        )
        rewards_by_type: dict[str, Decimal] = {}
        rewards_by_program: dict[str, dict] = {}
        rewards_by_card: dict[int, dict] = {}
        rewards_by_category: dict[int, dict] = {}
        rewards_by_player: dict[int | str, dict] = {}
        rewards_by_issuer: dict[str, dict] = {}
        rewards_by_store: dict[str, dict] = {}
        rewards_by_month: dict[str, dict] = {}
        reward_program_drilldowns: dict[str, dict] = {}
        instant_discount_groups: dict[str, dict] = {}
        instant_discount_details: list[dict] = []
        fuel_points_earned = Decimal("0")
        cashback_earned = Decimal("0")
        statement_credits_earned = Decimal("0")
        purchase_discounts_earned = Decimal("0")
        effective_reward_savings = Decimal("0")
        credit_cards_by_id = {card.id: card for card in credit_cards}

        for transaction in ranged_reward_transactions:
            cashback_earned += to_decimal(getattr(transaction, "cashback_amount", None))
            statement_credits_earned += to_decimal(
                getattr(transaction, "statement_credit_amount", None)
            )
            purchase_discounts_earned += to_decimal(
                getattr(transaction, "purchase_discount_amount", None)
            )
            effective_reward_savings += to_decimal(
                getattr(transaction, "effective_savings_amount", None)
            )
            purchase = purchases_by_id.get(transaction.purchase_id)
            card = credit_cards_by_id.get(transaction.credit_card_id)
            player = players.get(transaction.player_id) if transaction.player_id else None
            store_name = purchase.store_name if purchase else "Unknown Store"

            if is_instant_discount_transaction(transaction):
                add_instant_discount_metric(
                    groups=instant_discount_groups,
                    details=instant_discount_details,
                    transaction=transaction,
                    purchase=purchase,
                    card=card,
                    player=player,
                )
                continue

            program = reward_programs.get(transaction.reward_program_id)
            rewards_type = program.short_code if program else "OTHER"
            rewards_by_type[rewards_type] = (
                rewards_by_type.get(rewards_type, Decimal("0"))
                + to_decimal(transaction.rewards_earned)
            )
            program_key = (
                program.short_code if program else rewards_type
            )
            program_metric = rewards_by_program.setdefault(
                program_key,
                {
                    "reward_program_id": program.id if program else None,
                    "name": program.name if program else rewards_type,
                    "short_code": program.short_code if program else rewards_type,
                    "category": program.category if program else "Other",
                    "estimated_value_cents_per_point": (
                        program.estimated_value_cents_per_point if program else None
                    ),
                    "value_unit": program.value_unit if program else None,
                    "valuation_status": (
                        reward_program_valuation(program, Decimal("0"))[
                            "valuation_status"
                        ]
                    ),
                    "estimated_rewards_earned": Decimal("0"),
                    "estimated_value": Decimal("0"),
                },
            )
            reward_amount = to_decimal(transaction.rewards_earned)
            qualifying_spend = to_decimal(transaction.qualifying_spend)
            valuation = reward_program_valuation(program, reward_amount)
            estimated_value = valuation["estimated_value"]
            program_drilldown = reward_program_drilldowns.setdefault(
                program_key,
                {
                    "reward_program_id": program.id if program else None,
                    "name": program.name if program else rewards_type,
                    "short_code": program.short_code if program else rewards_type,
                    "category": program.category if program else "Other",
                    "estimated_value_cents_per_point": (
                        program.estimated_value_cents_per_point if program else None
                    ),
                    "value_unit": valuation["value_unit"],
                    "valuation_status": valuation["valuation_status"],
                    "cards": {},
                    "purchases": [],
                    "categories": {},
                    "months": {},
                    "players": {},
                },
            )
            program_metric["estimated_rewards_earned"] += reward_amount
            program_metric["estimated_value"] += estimated_value

            card = None
            if transaction.credit_card_id is not None:
                card = credit_cards_by_id.get(transaction.credit_card_id)
                card_metric = rewards_by_card.setdefault(
                    transaction.credit_card_id,
                    {
                        "credit_card_id": transaction.credit_card_id,
                        "nickname": card.nickname if card else "Unknown Card",
                        "issuer": card.issuer if card else "Unknown Issuer",
                        "player_id": card.player_id if card else None,
                        "player_label": (
                            players.get(card.player_id).label
                            if card and card.player_id in players
                            else None
                        ),
                        "rewards_type": rewards_type,
                        "estimated_rewards_earned": Decimal("0"),
                        "qualifying_spend": Decimal("0"),
                        "estimated_value": Decimal("0"),
                    },
                )
                card_metric["estimated_rewards_earned"] += reward_amount
                card_metric["qualifying_spend"] += qualifying_spend
                card_metric["estimated_value"] += estimated_value
                program_card_metric = program_drilldown["cards"].setdefault(
                    transaction.credit_card_id,
                    {
                        "credit_card_id": transaction.credit_card_id,
                        "nickname": card.nickname if card else "Unknown Card",
                        "issuer": card.issuer if card else "Unknown Issuer",
                        "player_label": (
                            players.get(card.player_id).label
                            if card and card.player_id in players
                            else None
                        ),
                        "qualifying_spend": Decimal("0"),
                        "estimated_rewards_earned": Decimal("0"),
                        "estimated_value": Decimal("0"),
                    },
                )
                program_card_metric["qualifying_spend"] += qualifying_spend
                program_card_metric["estimated_rewards_earned"] += reward_amount
                program_card_metric["estimated_value"] += estimated_value

                issuer_name = card.issuer if card else "Unknown Issuer"
                issuer_metric = rewards_by_issuer.setdefault(
                    issuer_name,
                    {
                        "issuer": issuer_name,
                        "estimated_rewards_earned": Decimal("0"),
                        "qualifying_spend": Decimal("0"),
                        "estimated_value": Decimal("0"),
                    },
                )
                issuer_metric["estimated_rewards_earned"] += reward_amount
                issuer_metric["qualifying_spend"] += qualifying_spend
                issuer_metric["estimated_value"] += estimated_value

            if transaction.spending_category_id is not None:
                category = spending_categories.get(transaction.spending_category_id)
                category_metric = rewards_by_category.setdefault(
                    transaction.spending_category_id,
                    {
                        "spending_category_id": transaction.spending_category_id,
                        "key": category.key if category else "unknown",
                        "name": category.name if category else "Unknown",
                        "estimated_rewards_earned": Decimal("0"),
                        "qualifying_spend": Decimal("0"),
                        "estimated_value": Decimal("0"),
                    },
                )
                category_metric["estimated_rewards_earned"] += reward_amount
                category_metric["qualifying_spend"] += qualifying_spend
                category_metric["estimated_value"] += estimated_value
                program_category_metric = program_drilldown["categories"].setdefault(
                    transaction.spending_category_id,
                    {
                        "spending_category_id": transaction.spending_category_id,
                        "key": category.key if category else "unknown",
                        "name": category.name if category else "Unknown",
                        "qualifying_spend": Decimal("0"),
                        "estimated_rewards_earned": Decimal("0"),
                        "estimated_value": Decimal("0"),
                    },
                )
                program_category_metric["qualifying_spend"] += qualifying_spend
                program_category_metric["estimated_rewards_earned"] += reward_amount
                program_category_metric["estimated_value"] += estimated_value

            player_key: int | str = transaction.player_id or "unassigned"
            player = players.get(transaction.player_id) if transaction.player_id else None
            player_metric = rewards_by_player.setdefault(
                player_key,
                {
                    "player_id": transaction.player_id,
                    "label": player.label if player else "Unassigned",
                    "name": player.name if player else None,
                    "estimated_rewards_earned": Decimal("0"),
                    "qualifying_spend": Decimal("0"),
                    "estimated_value": Decimal("0"),
                },
            )
            player_metric["estimated_rewards_earned"] += reward_amount
            player_metric["qualifying_spend"] += qualifying_spend
            player_metric["estimated_value"] += estimated_value
            program_player_metric = program_drilldown["players"].setdefault(
                player_key,
                {
                    "player_id": transaction.player_id,
                    "label": player.label if player else "Unassigned",
                    "name": player.name if player else None,
                    "qualifying_spend": Decimal("0"),
                    "estimated_rewards_earned": Decimal("0"),
                    "estimated_value": Decimal("0"),
                },
            )
            program_player_metric["qualifying_spend"] += qualifying_spend
            program_player_metric["estimated_rewards_earned"] += reward_amount
            program_player_metric["estimated_value"] += estimated_value

            store_metric = rewards_by_store.setdefault(
                store_name,
                {
                    "store_name": store_name,
                    "estimated_rewards_earned": Decimal("0"),
                    "qualifying_spend": Decimal("0"),
                    "estimated_value": Decimal("0"),
                },
            )
            store_metric["estimated_rewards_earned"] += reward_amount
            store_metric["qualifying_spend"] += qualifying_spend
            store_metric["estimated_value"] += estimated_value

            month_key = transaction.purchase_date.strftime("%Y-%m")
            month_metric = rewards_by_month.setdefault(
                month_key,
                {
                    "month": month_key,
                    "estimated_rewards_earned": Decimal("0"),
                    "qualifying_spend": Decimal("0"),
                    "estimated_value": Decimal("0"),
                },
            )
            month_metric["estimated_rewards_earned"] += reward_amount
            month_metric["qualifying_spend"] += qualifying_spend
            month_metric["estimated_value"] += estimated_value
            program_month_metric = program_drilldown["months"].setdefault(
                month_key,
                {
                    "month": month_key,
                    "qualifying_spend": Decimal("0"),
                    "estimated_rewards_earned": Decimal("0"),
                    "estimated_value": Decimal("0"),
                },
            )
            program_month_metric["qualifying_spend"] += qualifying_spend
            program_month_metric["estimated_rewards_earned"] += reward_amount
            program_month_metric["estimated_value"] += estimated_value
            program_drilldown["purchases"].append(
                {
                    "purchase_id": transaction.purchase_id,
                    "store_name": store_name,
                    "purchase_date": transaction.purchase_date,
                    "qualifying_spend": qualifying_spend,
                    "multiplier": transaction.multiplier,
                    "rewards_earned": reward_amount,
                    "estimated_value": estimated_value,
                    "credit_card_id": transaction.credit_card_id,
                    "credit_card_nickname": (
                        card.nickname
                        if transaction.credit_card_id is not None and card
                        else None
                    ),
                    "player_id": transaction.player_id,
                    "player_label": player.label if player else None,
                    "player_name": player.name if player else None,
                    "spending_category_id": transaction.spending_category_id,
                    "spending_category_name": (
                        spending_categories.get(transaction.spending_category_id).name
                        if transaction.spending_category_id in spending_categories
                        else None
                    ),
                    "reward_program_id": program.id if program else None,
                    "reward_program_name": program.name if program else rewards_type,
                    "reward_program_short_code": (
                        program.short_code if program else rewards_type
                    ),
                    "value_unit": valuation["value_unit"],
                    "valuation_status": valuation["valuation_status"],
                    "calculation_source": transaction.calculation_source,
                }
            )

        kroger_fuel_program = next(
            (
                program
                for program in reward_programs.values()
                if program.short_code == "KROGER_FUEL"
            ),
            None,
        )
        ranged_fuel_entries = [
            entry
            for entry in db.query(FuelPointEntry).all()
            if in_range(entry.earned_date, range_start, range_end)
            and (
                player_id is None
                or entry.purchase_batch_id in purchase_ids
            )
        ]

        if kroger_fuel_program and ranged_fuel_entries:
            fuel_metric = rewards_by_program.setdefault(
                kroger_fuel_program.short_code,
                {
                    "reward_program_id": kroger_fuel_program.id,
                    "name": kroger_fuel_program.name,
                    "short_code": kroger_fuel_program.short_code,
                    "category": kroger_fuel_program.category,
                    "estimated_value_cents_per_point": (
                        kroger_fuel_program.estimated_value_cents_per_point
                    ),
                    "value_unit": kroger_fuel_program.value_unit,
                    "valuation_status": (
                        reward_program_valuation(kroger_fuel_program, Decimal("0"))[
                            "valuation_status"
                        ]
                    ),
                    "estimated_rewards_earned": Decimal("0"),
                    "estimated_value": Decimal("0"),
                },
            )
            fuel_points = sum(
                Decimal(entry.points_earned) for entry in ranged_fuel_entries
            )
            fuel_points_earned = fuel_points
            fuel_metric["estimated_rewards_earned"] += fuel_points
            fuel_valuation = reward_program_valuation(kroger_fuel_program, fuel_points)
            fuel_metric["estimated_value"] += fuel_valuation["estimated_value"]
            fuel_drilldown = reward_program_drilldowns.setdefault(
                kroger_fuel_program.short_code,
                {
                    "reward_program_id": kroger_fuel_program.id,
                    "name": kroger_fuel_program.name,
                    "short_code": kroger_fuel_program.short_code,
                    "category": kroger_fuel_program.category,
                    "estimated_value_cents_per_point": (
                        kroger_fuel_program.estimated_value_cents_per_point
                    ),
                    "value_unit": fuel_valuation["value_unit"],
                    "valuation_status": fuel_valuation["valuation_status"],
                    "cards": {},
                    "purchases": [],
                    "categories": {},
                    "months": {},
                    "players": {},
                },
            )

            for entry in ranged_fuel_entries:
                purchase = purchases_by_id.get(entry.purchase_batch_id)
                month_key = entry.earned_date.strftime("%Y-%m")
                entry_rewards = Decimal(entry.points_earned)
                entry_valuation = reward_program_valuation(
                    kroger_fuel_program,
                    entry_rewards,
                )
                entry_estimated_value = entry_valuation["estimated_value"]
                fuel_month_metric = fuel_drilldown["months"].setdefault(
                    month_key,
                    {
                        "month": month_key,
                        "qualifying_spend": Decimal("0"),
                        "estimated_rewards_earned": Decimal("0"),
                        "estimated_value": Decimal("0"),
                    },
                )
                fuel_month_metric["estimated_rewards_earned"] += entry_rewards
                fuel_month_metric["estimated_value"] += entry_estimated_value
                fuel_drilldown["purchases"].append(
                    {
                        "purchase_id": entry.purchase_batch_id,
                        "store_name": purchase.store_name if purchase else "Fuel Entry",
                        "purchase_date": entry.earned_date,
                        "qualifying_spend": to_decimal(entry.qualifying_spend),
                        "multiplier": entry.multiplier,
                        "rewards_earned": entry_rewards,
                        "estimated_value": entry_estimated_value,
                        "credit_card_id": None,
                        "credit_card_nickname": None,
                        "player_id": None,
                        "player_label": None,
                        "player_name": None,
                        "spending_category_id": None,
                        "spending_category_name": "Fuel Rewards",
                        "reward_program_id": kroger_fuel_program.id,
                        "reward_program_name": kroger_fuel_program.name,
                        "reward_program_short_code": kroger_fuel_program.short_code,
                        "value_unit": entry_valuation["value_unit"],
                        "valuation_status": entry_valuation["valuation_status"],
                        "calculation_source": entry.entry_type or "fuel_points",
                    }
                )

        serialized_program_drilldowns = []

        for program_key, drilldown in reward_program_drilldowns.items():
            serialized_program_drilldowns.append(
                {
                    "reward_program_id": drilldown["reward_program_id"],
                    "name": drilldown["name"],
                    "short_code": drilldown["short_code"],
                    "category": drilldown["category"],
                    "estimated_value_cents_per_point": drilldown[
                        "estimated_value_cents_per_point"
                    ],
                    "value_unit": drilldown["value_unit"],
                    "valuation_status": drilldown["valuation_status"],
                    "cards": sorted(
                        drilldown["cards"].values(),
                        key=lambda metric: metric["estimated_rewards_earned"],
                        reverse=True,
                    ),
                    "purchases": sorted(
                        drilldown["purchases"],
                        key=lambda purchase: purchase["purchase_date"] or date.min,
                        reverse=True,
                    )[:50],
                    "categories": sorted(
                        drilldown["categories"].values(),
                        key=lambda metric: metric["estimated_rewards_earned"],
                        reverse=True,
                    ),
                    "months": sorted(
                        drilldown["months"].values(),
                        key=lambda metric: metric["month"],
                        reverse=True,
                    ),
                    "players": sorted(
                        drilldown["players"].values(),
                        key=lambda metric: metric["estimated_rewards_earned"],
                        reverse=True,
                    ),
                }
            )

        active_signup_bonuses = []
        signup_bonuses_earned = Decimal("0")

        for card in active_credit_cards:
            required_spend = to_decimal(card.signup_bonus_spend)

            if required_spend <= 0:
                continue

            current_progress = to_decimal(card.current_spend_progress)
            remaining_spend = max(Decimal("0"), required_spend - current_progress)
            progress_percent = (
                (current_progress / required_spend) * Decimal("100")
                if required_spend > 0
                else Decimal("0")
            )
            is_completed = current_progress >= required_spend

            if is_completed:
                signup_bonuses_earned += Decimal(card.signup_bonus_points or 0)
            elif (
                card.signup_bonus_deadline is None
                or card.signup_bonus_deadline >= today
            ):
                active_signup_bonuses.append(
                    {
                        "credit_card_id": card.id,
                        "nickname": card.nickname,
                        "issuer": card.issuer,
                        "player_id": card.player_id,
                        "player_label": (
                            players.get(card.player_id).label
                            if card.player_id in players
                            else None
                        ),
                        "required_spend": required_spend,
                        "current_progress": current_progress,
                        "remaining_spend": remaining_spend,
                        "deadline": card.signup_bonus_deadline,
                        "progress_percent": min(progress_percent, Decimal("100")),
                        "signup_bonus_points": card.signup_bonus_points or 0,
                    }
                )

        for metric in rewards_by_card.values():
            spend = to_decimal(metric["qualifying_spend"])
            metric["effective_multiplier"] = (
                to_decimal(metric["estimated_rewards_earned"]) / spend
                if spend > 0
                else Decimal("0")
            )

        for metric in rewards_by_issuer.values():
            spend = to_decimal(metric["qualifying_spend"])
            metric["effective_multiplier"] = (
                to_decimal(metric["estimated_rewards_earned"]) / spend
                if spend > 0
                else Decimal("0")
            )

        return {
            "reporting_range": range,
            "reporting_range_start": range_start,
            "reporting_range_end": range_end,
            "range_total_purchases": sum(
                to_decimal(purchase.purchase_total_paid)
                for purchase in ranged_purchases
            ),
            "range_total_sales": sum(
                to_decimal(row["expected_payout"])
                for row in range_sale_kpis["rows"]
                if row["included_in_gross_sales"]
            ),
            "range_profit": sum(
                to_decimal(card.payout_received) - to_decimal(card.acquisition_cost)
                for card in ranged_settled_cards
                if card.payout_received is not None
            ),
            "rewards_by_type": [
                {"rewards_type": key, "estimated_rewards_earned": value}
                for key, value in sorted(rewards_by_type.items())
            ],
            "rewards_by_program": sorted(
                rewards_by_program.values(),
                key=lambda metric: metric["estimated_rewards_earned"],
                reverse=True,
            ),
            "reward_program_drilldowns": sorted(
                serialized_program_drilldowns,
                key=lambda metric: next(
                    (
                        program_metric["estimated_rewards_earned"]
                        for program_metric in rewards_by_program.values()
                        if program_metric["short_code"] == metric["short_code"]
                    ),
                    Decimal("0"),
                ),
                reverse=True,
            ),
            "rewards_by_card": sorted(
                rewards_by_card.values(),
                key=lambda metric: metric["estimated_rewards_earned"],
                reverse=True,
            ),
            "rewards_by_issuer": sorted(
                rewards_by_issuer.values(),
                key=lambda metric: metric["estimated_rewards_earned"],
                reverse=True,
            ),
            "rewards_by_category": sorted(
                rewards_by_category.values(),
                key=lambda metric: metric["estimated_rewards_earned"],
                reverse=True,
            ),
            "rewards_by_player": sorted(
                rewards_by_player.values(),
                key=lambda metric: metric["estimated_rewards_earned"],
                reverse=True,
            ),
            "rewards_by_store": sorted(
                rewards_by_store.values(),
                key=lambda metric: metric["estimated_rewards_earned"],
                reverse=True,
            ),
            "rewards_by_month": sorted(
                rewards_by_month.values(),
                key=lambda metric: metric["month"],
                reverse=True,
            ),
            "pending_rewards": Decimal("0"),
            "fuel_points_earned": fuel_points_earned,
            "cashback_earned": cashback_earned,
            "statement_credits_earned": statement_credits_earned,
            "purchase_discounts_earned": purchase_discounts_earned,
            "purchase_time_discounts_earned": purchase_discounts_earned,
            "effective_reward_savings": effective_reward_savings,
            "instant_discounts": {
                "total_saved": sum(
                    to_decimal(group["total_saved"])
                    for group in instant_discount_groups.values()
                ),
                "eligible_spend": sum(
                    to_decimal(group["eligible_spend"])
                    for group in instant_discount_groups.values()
                ),
                "count": sum(
                    int(group["count"])
                    for group in instant_discount_groups.values()
                ),
                "groups": sorted(
                    instant_discount_groups.values(),
                    key=lambda group: group["total_saved"],
                    reverse=True,
                ),
                "details": sorted(
                    instant_discount_details,
                    key=lambda detail: detail["purchase_date"] or date.min,
                    reverse=True,
                )[:50],
            },
            "signup_bonuses_earned": signup_bonuses_earned,
            "active_signup_bonuses": sorted(
                active_signup_bonuses,
                key=lambda bonus: (
                    bonus["deadline"] is None,
                    bonus["deadline"] or date.max,
                ),
            ),
            "total_available_inventory_face_value": sum(
                to_decimal(card.face_value) for card in available_cards
            ),
            "total_card_acquisition_cost": sum(
                to_decimal(card.acquisition_cost)
                for card in gift_cards
                if card.status in {
                    "VERIFIED_AVAILABLE",
                    "SOLD_PENDING_PAYMENT",
                    "SETTLED",
                }
            ),
            "available_acquisition_cost": sum(
                to_decimal(card.acquisition_cost) for card in available_cards
            ),
            "pending_verification_face_value": sum(
                to_decimal(card.face_value) for card in pending_verification_cards
            ),
            "pending_verification_count": len(pending_verification_cards),
            "awaiting_payment_total": sum(
                to_decimal(row["expected_payout"]) - to_decimal(row["received_amount"])
                for row in range_sale_kpis["rows"]
                if row["included_in_outstanding_receivables"]
            ),
            "outstanding_receivables": range_sale_kpis["outstanding_receivables"],
            "awaiting_payment_expected_profit": sum(
                to_decimal(card.expected_payout) - to_decimal(card.acquisition_cost)
                for card in awaiting_payment_cards
                if card.expected_payout is not None
            ),
            "settled_revenue": settled_revenue,
            "realized_profit": realized_profit,
            "unsold_inventory_count": len(available_cards),
            "awaiting_payment_count": len(awaiting_payment_sales),
            "overdue_payment_count": len(overdue_payment_sales),
            "purchases_needing_receipts_count": len(purchases_needing_receipts),
            "fuel_points_available": fuel_points_available,
            "fuel_accounts_near_target": len(fuel_accounts_near_target),
            "credit_card_estimated_balances": sum(
                to_decimal(card.current_balance) for card in active_credit_cards
            ),
            "credit_card_utilization_warnings": len(high_utilization_cards),
            "purchase_batch_count": purchase_count,
            "top_buyer_by_volume": top_buyer_by_volume,
            "highest_profit_buyer": highest_profit_buyer,
            "overdue_buyers": [
                report for report in buyer_reports if report["overdue_count"] > 0
            ],
            "warnings": {
                "overdue_payments": [
                    {
                        "id": sale.id,
                        "brand": f"Sale #{sale.id}",
                        "buyer_name": next(
                            (
                                buyer.name
                                for buyer in buyers
                                if buyer.id == sale.buyer_id
                            ),
                            None,
                        ),
                        "expected_payout": sale_unpaid_expected_total(db, sale),
                        "expected_payment_date": sale_expected_payment_date(db, sale),
                    }
                    for sale in overdue_payment_sales[:10]
                ],
                "fuel_accounts_near_target": fuel_accounts_near_target[:10],
                "fuel_accounts_near_expiration": fuel_accounts_near_expiration[:10],
                "high_utilization_credit_cards": high_utilization_cards[:10],
            },
        }
    finally:
        db.close()


@router.get("/financial-debug")
def dashboard_financial_debug(range: str = "ytd"):
    db: Session = SessionLocal()
    today = date.today()
    range_start = get_range_start(range, today)
    range_end = get_range_end(range, today)

    try:
        sales = db.query(Sale).order_by(Sale.sold_at.desc(), Sale.id.desc()).all()
        kpis = sale_financial_kpis(sales, range_start, range_end)

        return {
            "reporting_range": range,
            "reporting_range_start": range_start,
            "reporting_range_end": range_end,
            "ytd_gross_sales": kpis["gross_sales"],
            "settled_revenue": kpis["settled_revenue"],
            "outstanding_receivables": kpis["outstanding_receivables"],
            "sales": kpis["rows"],
        }
    finally:
        db.close()
