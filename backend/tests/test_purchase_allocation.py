from datetime import datetime
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.card_issuer import CardIssuer
from app.models.card_network import CardNetwork
from app.models.buyer import Buyer
from app.models.credit_card import CreditCard
from app.models.credit_card_product_change import CreditCardProductChange
from app.models.credit_card_reward_rule import CreditCardRewardRule
from app.models.credit_card_reward_transaction import CreditCardRewardTransaction
from app.models.gift_card import GiftCard
from app.models.payment_account import PaymentAccount
from app.models.player import Player
from app.models.purchase_batch import PurchaseBatch
from app.models.purchase_payment import PurchasePayment
from app.models.reward_program import RewardProgram
from app.models.spending_category import SpendingCategory
from app.models.store import Store
from app.services.purchase_allocation import recalculate_purchase_allocation


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def make_purchase(db, total_paid: str = "1517.76") -> PurchaseBatch:
    purchase = PurchaseBatch(
        store_name="Fred Meyer",
        purchase_date=datetime(2026, 5, 25),
        total_amount=Decimal("0"),
        purchase_total_paid=Decimal(total_paid),
    )
    db.add(purchase)
    db.flush()
    return purchase


def make_card(
    db,
    purchase_id: int,
    brand: str,
    face_value: str,
    acquisition_cost: str,
) -> GiftCard:
    card = GiftCard(
        purchase_batch_id=purchase_id,
        brand=brand,
        face_value=Decimal(face_value),
        acquisition_cost=Decimal(acquisition_cost),
        status="VERIFIED_AVAILABLE",
    )
    db.add(card)
    db.flush()
    return card


def test_mixed_receipt_total_does_not_inflate_card_costs():
    db = make_session()
    purchase = make_purchase(db, "1517.76")
    best_buy = make_card(db, purchase.id, "Best Buy", "500", "500")
    nike = make_card(db, purchase.id, "Nike", "250", "250")
    make_card(db, purchase.id, "Best Buy", "500", "500")
    make_card(db, purchase.id, "Nike", "250", "250")

    result = recalculate_purchase_allocation(db, purchase.id)
    db.refresh(best_buy)
    db.refresh(nike)

    assert best_buy.acquisition_cost == Decimal("500")
    assert nike.acquisition_cost == Decimal("250")
    assert result["total_face_value"] == Decimal("1500.00")
    assert result["total_allocated_cost"] == Decimal("1500")
    assert result["allocation_difference"] == Decimal("17.76")
    assert result["cards_updated"] == 0


def test_discounted_card_cost_is_preserved():
    db = make_session()
    purchase = make_purchase(db, "100")
    card = make_card(db, purchase.id, "DoorDash", "100", "79.99")

    recalculate_purchase_allocation(db, purchase.id)
    db.refresh(card)

    assert card.acquisition_cost == Decimal("79.99")


def test_recalculate_after_move_does_not_change_cost_basis():
    db = make_session()
    source = make_purchase(db, "100")
    destination = make_purchase(db, "150")
    card = make_card(db, source.id, "Target", "500", "475")

    card.purchase_batch_id = destination.id
    db.flush()
    recalculate_purchase_allocation(db, source.id)
    recalculate_purchase_allocation(db, destination.id)
    db.refresh(card)

    assert card.acquisition_cost == Decimal("475")
