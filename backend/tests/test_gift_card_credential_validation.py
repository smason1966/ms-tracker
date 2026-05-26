from datetime import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.gift_cards import GiftCardVerify, verify_gift_card
from app.db.base import Base
from app.models.buyer import Buyer
from app.models.card_issuer import CardIssuer
from app.models.card_network import CardNetwork
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


def make_card(db, *, brand: str) -> GiftCard:
    purchase = PurchaseBatch(
        store_name="Target",
        purchase_date=datetime(2026, 5, 25),
        total_amount=Decimal("0"),
    )
    db.add(purchase)
    db.commit()
    db.refresh(purchase)

    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand=brand,
        face_value=Decimal("100"),
        acquisition_cost=Decimal("100"),
        status="NEEDS_VERIFICATION",
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return card


def verify_with_payload(session_factory, monkeypatch, card_id: int, **payload):
    monkeypatch.setattr("app.api.gift_cards.SessionLocal", session_factory)
    return verify_gift_card(card_id, GiftCardVerify(**payload))


def test_best_buy_16_digit_card_and_4_digit_pin_pass(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    card = make_card(setup_db, brand="Best Buy")
    card_id = card.id
    setup_db.close()

    updated = verify_with_payload(
        session_factory,
        monkeypatch,
        card_id,
        card_number="6332 2600-7402 1047",
        confirmed_pin="1350",
    )

    assert updated["confirmed_card_number"] == "6332260074021047"
    assert updated["confirmed_pin"] == "1350"


def test_best_buy_wrong_card_length_fails(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    card = make_card(setup_db, brand="Best Buy")
    card_id = card.id
    setup_db.close()

    with pytest.raises(HTTPException) as exc:
        verify_with_payload(
            session_factory,
            monkeypatch,
            card_id,
            card_number="633226007402104",
            confirmed_pin="1350",
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "Best Buy card number must be 16 digits."


def test_best_buy_wrong_pin_length_fails(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    card = make_card(setup_db, brand="Best Buy")
    card_id = card.id
    setup_db.close()

    with pytest.raises(HTTPException) as exc:
        verify_with_payload(
            session_factory,
            monkeypatch,
            card_id,
            card_number="6332260074021047",
            confirmed_pin="135",
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "Best Buy PIN must be 4 digits."


def test_nike_19_digit_card_and_6_digit_pin_pass(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    card = make_card(setup_db, brand="Nike")
    card_id = card.id
    setup_db.close()

    updated = verify_with_payload(
        session_factory,
        monkeypatch,
        card_id,
        card_number="6060-1061-2225-3740-414",
        confirmed_pin="562132",
    )

    assert updated["confirmed_card_number"] == "6060106122253740414"
    assert updated["confirmed_pin"] == "562132"


def test_nike_wrong_card_length_fails(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    card = make_card(setup_db, brand="Nike")
    card_id = card.id
    setup_db.close()

    with pytest.raises(HTTPException) as exc:
        verify_with_payload(
            session_factory,
            monkeypatch,
            card_id,
            card_number="6060106122253740",
            confirmed_pin="562132",
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "Nike card number must be 19 digits."


def test_nike_wrong_pin_length_fails(monkeypatch):
    session_factory = make_session_factory()
    setup_db = session_factory()
    card = make_card(setup_db, brand="Nike")
    card_id = card.id
    setup_db.close()

    with pytest.raises(HTTPException) as exc:
        verify_with_payload(
            session_factory,
            monkeypatch,
            card_id,
            card_number="6060106122253740414",
            confirmed_pin="56213",
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "Nike PIN must be 6 digits."
