from datetime import datetime
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import purchase_batches, purchase_payments
from app.db.base import Base
from app.models.card_issuer import CardIssuer  # noqa: F401
from app.models.card_network import CardNetwork  # noqa: F401
from app.models.buyer import Buyer  # noqa: F401
from app.models.credit_card import CreditCard
from app.models.credit_card_product_change import CreditCardProductChange  # noqa: F401
from app.models.credit_card_reward_rule import CreditCardRewardRule
from app.models.credit_card_reward_transaction import CreditCardRewardTransaction
from app.models.gift_card import GiftCard
from app.models.payment_account import PaymentAccount  # noqa: F401
from app.models.player import Player  # noqa: F401
from app.models.purchase_batch import PurchaseBatch
from app.models.purchase_payment import PurchasePayment
from app.models.reward_program import RewardProgram
from app.models.spending_category import SpendingCategory
from app.models.store import Store
from scripts.encrypt_sensitive_fields import initialize_model_registry


def make_session_factory():
    initialize_model_registry()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def seed_purchase_59_style_batch(session_factory):
    db = session_factory()
    category = SpendingCategory(key="electronics", name="Electronics")
    program = RewardProgram(
        name="Bank Points",
        short_code="BANK",
        category="Bank",
        active=True,
    )
    card = CreditCard(
        nickname="Rewards Visa",
        issuer="Bank",
        network="Visa",
        credit_limit=Decimal("10000"),
        rewards_type="points",
    )
    db.add_all([category, program, card])
    db.flush()
    store = Store(
        name="Fred Meyer",
        spending_category_id=category.id,
        merchant_category="grocery",
        active=True,
    )
    db.add(store)
    db.flush()
    card.reward_program_id = program.id
    db.add(
        CreditCardRewardRule(
            credit_card_id=card.id,
            spending_category_id=category.id,
            reward_type="points",
            reward_program_id=program.id,
            multiplier=Decimal("1"),
            value=Decimal("1"),
            priority=100,
        )
    )
    purchase = PurchaseBatch(
        store_name="Fred Meyer",
        purchase_date=datetime(2026, 5, 29),
        total_amount=Decimal("1500.00"),
        purchase_total_paid=Decimal("1504.76"),
        credit_card_id=card.id,
    )
    db.add(purchase)
    db.flush()
    for brand, face_value in [
        ("Best Buy", Decimal("500")),
        ("Best Buy", Decimal("500")),
        ("Nike", Decimal("250")),
        ("Nike", Decimal("250")),
    ]:
        db.add(
            GiftCard(
                purchase_batch_id=purchase.id,
                brand=brand,
                face_value=face_value,
                acquisition_cost=face_value,
                status="NEEDS_VERIFICATION",
            )
        )
    db.commit()
    purchase_id = purchase.id
    card_id = card.id
    category_id = category.id
    db.close()
    return purchase_id, card_id, category_id


def test_purchase_without_payments_has_missing_funding_diagnostic(monkeypatch):
    session_factory = make_session_factory()
    purchase_id, _, _ = seed_purchase_59_style_batch(session_factory)
    monkeypatch.setattr(purchase_batches, "SessionLocal", session_factory)

    result = purchase_batches.recalculate_purchase_rewards(purchase_id)

    assert result["transaction_count"] == 0
    assert result["eligible_payment_count"] == 0
    assert result["skipped_reason"] == "No credit card funding/payment rows recorded."


def test_add_credit_card_purchase_payment_calculates_reward_fields(monkeypatch):
    session_factory = make_session_factory()
    purchase_id, card_id, category_id = seed_purchase_59_style_batch(session_factory)
    monkeypatch.setattr(purchase_payments, "SessionLocal", session_factory)

    payment = purchase_payments.add_purchase_payment(
        purchase_id,
        purchase_payments.PurchasePaymentCreate(
            payment_type="CREDIT_CARD",
            credit_card_id=card_id,
            amount=Decimal("1504.76"),
            spending_category_id=category_id,
        ),
    )

    assert payment.payment_type == "CREDIT_CARD"
    assert payment.credit_card_id == card_id
    assert payment.spending_category_id == category_id
    assert payment.reward_multiplier == Decimal("1.0000")
    assert payment.calculated_rewards == Decimal("1504.7600")
    assert payment.points_earned == Decimal("1504.7600")


def test_recalculate_rewards_is_idempotent(monkeypatch):
    session_factory = make_session_factory()
    purchase_id, card_id, category_id = seed_purchase_59_style_batch(session_factory)
    monkeypatch.setattr(purchase_payments, "SessionLocal", session_factory)
    monkeypatch.setattr(purchase_batches, "SessionLocal", session_factory)
    purchase_payments.add_purchase_payment(
        purchase_id,
        purchase_payments.PurchasePaymentCreate(
            payment_type="CREDIT_CARD",
            credit_card_id=card_id,
            amount=Decimal("1504.76"),
            spending_category_id=category_id,
        ),
    )

    first = purchase_batches.recalculate_purchase_rewards(purchase_id)
    second = purchase_batches.recalculate_purchase_rewards(purchase_id)

    assert first["transaction_count"] == 1
    assert second["transaction_count"] == 1
    assert second["updated_count"] == 1

    db = session_factory()
    try:
        transactions = (
            db.query(CreditCardRewardTransaction)
            .filter(CreditCardRewardTransaction.purchase_id == purchase_id)
            .all()
        )
        payments = (
            db.query(PurchasePayment)
            .filter(PurchasePayment.purchase_batch_id == purchase_id)
            .all()
        )
        assert len(transactions) == 1
        assert len(payments) == 1
        assert transactions[0].qualifying_spend == Decimal("1504.76")
        assert transactions[0].points_earned == Decimal("1504.7600")
    finally:
        db.close()
