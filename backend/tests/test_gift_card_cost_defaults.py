from datetime import datetime
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

from app.api.gift_cards import GiftCardCreate, GiftCardUpdate, create_gift_card, update_gift_card
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
from app.models.sale import Sale
from app.models.sale_gift_card import SaleGiftCard
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

    assert card["acquisition_cost"] == Decimal("500")


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

    assert card["acquisition_cost"] == Decimal("79.99")


def test_unsold_card_value_cost_correction_is_allowed(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    purchase = make_purchase(setup_db)
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Nike",
        face_value=Decimal("259"),
        acquisition_cost=Decimal("259"),
        status="NEEDS_VERIFICATION",
    )
    setup_db.add(card)
    setup_db.commit()
    card_id = card.id
    setup_db.close()
    monkeypatch.setattr(db_session, "SessionLocal", session_factory)
    monkeypatch.setattr("app.api.gift_cards.SessionLocal", session_factory)

    updated = update_gift_card(
        card_id,
        GiftCardUpdate(
            face_value=Decimal("250"),
            acquisition_cost=Decimal("250"),
        ),
    )

    assert updated["face_value"] == Decimal("250")
    assert updated["acquisition_cost"] == Decimal("250")


def test_sold_card_value_cost_correction_is_blocked(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    purchase = make_purchase(setup_db)
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Nike",
        face_value=Decimal("259"),
        acquisition_cost=Decimal("259"),
        status="SOLD_PENDING_PAYMENT",
    )
    setup_db.add(card)
    setup_db.commit()
    card_id = card.id
    setup_db.close()
    monkeypatch.setattr(db_session, "SessionLocal", session_factory)
    monkeypatch.setattr("app.api.gift_cards.SessionLocal", session_factory)

    try:
        update_gift_card(card_id, GiftCardUpdate(face_value=Decimal("250")))
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "locked" in str(exc.detail)
    else:
        raise AssertionError("Expected sold card value correction to be blocked")


def test_sale_linked_card_value_cost_correction_is_blocked(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    purchase = make_purchase(setup_db)
    buyer = Buyer(name="Buyer")
    setup_db.add(buyer)
    setup_db.commit()
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Nike",
        face_value=Decimal("259"),
        acquisition_cost=Decimal("259"),
        status="VERIFIED_AVAILABLE",
    )
    setup_db.add(card)
    setup_db.commit()
    sale = Sale(
        buyer_id=buyer.id,
        expected_payout=Decimal("250"),
        status="VOIDED",
    )
    setup_db.add(sale)
    setup_db.commit()
    setup_db.add(
        SaleGiftCard(
            sale_id=sale.id,
            gift_card_id=card.id,
            expected_payout=Decimal("250"),
        )
    )
    setup_db.commit()
    card_id = card.id
    setup_db.close()
    monkeypatch.setattr(db_session, "SessionLocal", session_factory)
    monkeypatch.setattr("app.api.gift_cards.SessionLocal", session_factory)

    try:
        update_gift_card(card_id, GiftCardUpdate(face_value=Decimal("250")))
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "sale history" in str(exc.detail)
    else:
        raise AssertionError("Expected sale-linked card value correction to be blocked")
