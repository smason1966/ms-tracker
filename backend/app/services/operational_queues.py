from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch
from app.models.receipt import Receipt
from app.models.sale import Sale
from app.models.sale_fuel_account import SaleFuelAccount
from app.models.sale_gift_card import SaleGiftCard


AWAITING_SALE_STATUSES = {"ACTIVE", "SOLD_PENDING_PAYMENT", "PARTIALLY_SETTLED"}


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    return Decimal(str(value))


def sale_unpaid_expected_total(db: Session, sale: Sale) -> Decimal:
    card_total = sum(
        to_decimal(row.expected_payout)
        for row in db.query(SaleGiftCard)
        .filter(SaleGiftCard.sale_id == sale.id)
        .filter(SaleGiftCard.settlement_received_at.is_(None))
        .all()
    )
    fuel_total = sum(
        to_decimal(row.expected_value)
        for row in db.query(SaleFuelAccount)
        .filter(SaleFuelAccount.sale_id == sale.id)
        .filter(SaleFuelAccount.settlement_received_at.is_(None))
        .all()
    )

    return card_total + fuel_total


def sale_expected_payment_date(db: Session, sale: Sale) -> date | None:
    card_dates = [
        card.expected_payment_date
        for _, card in db.query(SaleGiftCard, GiftCard)
        .join(GiftCard, GiftCard.id == SaleGiftCard.gift_card_id)
        .filter(SaleGiftCard.sale_id == sale.id)
        .filter(SaleGiftCard.settlement_received_at.is_(None))
        .all()
        if card.expected_payment_date is not None
    ]
    fuel_dates = [
        account.expected_payment_date
        for _, account in db.query(SaleFuelAccount, FuelRewardAccount)
        .join(
            FuelRewardAccount,
            FuelRewardAccount.id == SaleFuelAccount.fuel_reward_account_id,
        )
        .filter(SaleFuelAccount.sale_id == sale.id)
        .filter(SaleFuelAccount.settlement_received_at.is_(None))
        .all()
        if account.expected_payment_date is not None
    ]
    dates = [*card_dates, *fuel_dates]

    return min(dates) if dates else None


def get_awaiting_payment_sales(db: Session) -> list[Sale]:
    sales = db.query(Sale).all()

    return [
        sale
        for sale in sales
        if sale.status in AWAITING_SALE_STATUSES
        and sale.status != "VOIDED"
        and sale_unpaid_expected_total(db, sale) > 0
    ]


def purchase_needs_receipt(db: Session, purchase: PurchaseBatch) -> bool:
    receipt_count = (
        db.query(Receipt)
        .filter(Receipt.purchase_batch_id == purchase.id)
        .count()
    )
    paid_amount = (
        purchase.purchase_total_paid
        if purchase.purchase_total_paid is not None
        else purchase.total_amount
    )

    return receipt_count == 0 and to_decimal(paid_amount) > 0


def get_purchases_needing_receipts(db: Session) -> list[PurchaseBatch]:
    purchases = db.query(PurchaseBatch).all()

    return [
        purchase for purchase in purchases if purchase_needs_receipt(db, purchase)
    ]
