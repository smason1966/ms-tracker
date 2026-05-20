from datetime import date
from decimal import Decimal

from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.credit_card import CreditCard
from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    return Decimal(str(value))


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


@router.get("/summary")
def dashboard_summary():
    db: Session = SessionLocal()
    today = date.today()

    try:
        gift_cards = db.query(GiftCard).all()
        fuel_accounts = db.query(FuelRewardAccount).all()
        credit_cards = db.query(CreditCard).all()
        purchase_count = db.query(PurchaseBatch).count()

        available_cards = [
            card for card in gift_cards if card.status == "VERIFIED_AVAILABLE"
        ]
        awaiting_payment_cards = [
            card
            for card in gift_cards
            if card.status in {"SOLD_PENDING_PAYMENT", "SOLD"}
        ]
        settled_cards = [card for card in gift_cards if card.status == "SETTLED"]

        overdue_payment_cards = [
            card
            for card in awaiting_payment_cards
            if card.expected_payment_date is not None
            and card.expected_payment_date < today
        ]

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

        settled_revenue = sum(
            to_decimal(card.payout_received) for card in settled_cards
        )
        realized_profit = sum(
            to_decimal(card.payout_received) - to_decimal(card.acquisition_cost)
            for card in settled_cards
            if card.payout_received is not None
        )

        return {
            "total_available_inventory_face_value": sum(
                to_decimal(card.face_value) for card in available_cards
            ),
            "total_acquisition_cost": sum(
                to_decimal(card.acquisition_cost)
                for card in gift_cards
                if card.status in {
                    "VERIFIED_AVAILABLE",
                    "SOLD_PENDING_PAYMENT",
                    "SOLD",
                    "SETTLED",
                }
            ),
            "awaiting_payment_total": sum(
                to_decimal(card.expected_payout) for card in awaiting_payment_cards
            ),
            "settled_revenue": settled_revenue,
            "realized_profit": realized_profit,
            "unsold_inventory_count": len(available_cards),
            "awaiting_payment_count": len(awaiting_payment_cards),
            "overdue_payment_count": len(overdue_payment_cards),
            "fuel_points_available": fuel_points_available,
            "fuel_accounts_near_target": len(fuel_accounts_near_target),
            "credit_card_estimated_balances": sum(
                to_decimal(card.current_balance) for card in active_credit_cards
            ),
            "credit_card_utilization_warnings": len(high_utilization_cards),
            "purchase_batch_count": purchase_count,
            "warnings": {
                "overdue_payments": [
                    {
                        "id": card.id,
                        "brand": card.brand,
                        "buyer_name": card.sold_to,
                        "expected_payout": card.expected_payout,
                        "expected_payment_date": card.expected_payment_date,
                    }
                    for card in overdue_payment_cards[:10]
                ],
                "fuel_accounts_near_target": fuel_accounts_near_target[:10],
                "fuel_accounts_near_expiration": fuel_accounts_near_expiration[:10],
                "high_utilization_credit_cards": high_utilization_cards[:10],
            },
        }
    finally:
        db.close()
