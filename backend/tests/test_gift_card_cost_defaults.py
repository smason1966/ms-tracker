from datetime import datetime
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.gift_cards import GiftCardCreate, create_gift_card
from app.db import session as db_session
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


def make_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def make_purchase(db) -> PurchaseBatch:
    purchase = PurchaseBatch(
        store_name="Costco",
        purchase_date=datetime(2026, 5, 25),
        total_amount=Decimal("0"),
        purchase_total_paid=Decimal("179.99"),
    )
    db.add(purchase)
    db.commit()
    db.refresh(purchase)
    return purchase


def test_missing_acquisition_cost_defaults_to_face_value(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    purchase = make_purchase(setup_db)
    setup_db.close()
    monkeypatch.setattr(db_session, "SessionLocal", session_factory)
    monkeypatch.setattr("app.api.gift_cards.SessionLocal", session_factory)

    card = create_gift_card(
        GiftCardCreate(
            purchase_batch_id=purchase.id,
            brand="Best Buy",
            face_value=Decimal("500"),
            acquisition_cost=None,
        )
    )

    assert card.acquisition_cost == Decimal("500")


def test_explicit_acquisition_cost_is_preserved(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    purchase = make_purchase(setup_db)
    setup_db.close()
    monkeypatch.setattr(db_session, "SessionLocal", session_factory)
    monkeypatch.setattr("app.api.gift_cards.SessionLocal", session_factory)

    card = create_gift_card(
        GiftCardCreate(
            purchase_batch_id=purchase.id,
            brand="DoorDash",
            face_value=Decimal("100"),
            acquisition_cost=Decimal("79.99"),
        )
    )

    assert card.acquisition_cost == Decimal("79.99")
