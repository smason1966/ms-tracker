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
from app.services.credit_card_rewards import sync_automatic_reward_transactions
from app.api.purchase_batches import apply_purchase_discount_rule


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def seed_categories(db):
    categories = {}
    for key, name in [
        ("general", "General"),
        ("fuel", "Fuel"),
        ("dining", "Dining"),
        ("target", "Target"),
    ]:
        category = SpendingCategory(key=key, name=name)
        db.add(category)
        db.flush()
        categories[key] = category
    return categories


def test_target_circle_mastercard_uses_instant_discount_not_points():
    db = make_session()
    categories = seed_categories(db)
    program = RewardProgram(
        name="Target Circle Rewards",
        short_code="TARGET",
        category="Other",
        active=True,
    )
    card = CreditCard(
        nickname="Target Circle Mastercard",
        issuer="Target",
        network="Mastercard",
        credit_limit=Decimal("5000"),
        rewards_type="OTHER",
        reward_program_id=None,
    )
    store = Store(
        name="Target",
        merchant_type="target",
        merchant_category="target",
        spending_category_id=categories["target"].id,
        active=True,
    )
    db.add_all([program, card, store])
    db.flush()

    db.add_all(
        [
            CreditCardRewardRule(
                credit_card_id=card.id,
                spending_category_id=categories["target"].id,
                reward_type="instant_discount_percent",
                merchant_type="target",
                multiplier=Decimal("0"),
                value=Decimal("5"),
                priority=10,
            ),
            CreditCardRewardRule(
                credit_card_id=card.id,
                spending_category_id=categories["fuel"].id,
                reward_type="points",
                reward_program_id=program.id,
                multiplier=Decimal("2"),
                value=Decimal("2"),
                priority=100,
            ),
            CreditCardRewardRule(
                credit_card_id=card.id,
                spending_category_id=categories["general"].id,
                reward_type="points",
                reward_program_id=program.id,
                multiplier=Decimal("1"),
                value=Decimal("1"),
                priority=200,
            ),
        ]
    )
    purchase = PurchaseBatch(
        store_name="Target",
        purchase_date=datetime(2026, 5, 24),
        total_amount=Decimal("500"),
        purchase_total_paid=Decimal("475"),
        credit_card_id=card.id,
    )
    db.add(purchase)
    db.flush()
    db.add(
        PurchasePayment(
            purchase_batch_id=purchase.id,
            payment_type="CREDIT_CARD",
            credit_card_id=card.id,
            amount=Decimal("475"),
        )
    )
    db.flush()

    transactions = sync_automatic_reward_transactions(db, purchase.id)

    assert len(transactions) == 1
    transaction = transactions[0]
    assert transaction.reward_type == "instant_discount_percent"
    assert transaction.points_earned == Decimal("0")
    assert transaction.rewards_earned == Decimal("0")
    assert transaction.purchase_discount_amount == Decimal("25")
    assert transaction.effective_savings_amount == Decimal("25")


def test_category_rule_still_awards_points_when_no_merchant_override_matches():
    db = make_session()
    categories = seed_categories(db)
    program = RewardProgram(
        name="Target Circle Rewards",
        short_code="TARGET",
        category="Other",
        active=True,
    )
    card = CreditCard(
        nickname="Target Circle Mastercard",
        issuer="Target",
        network="Mastercard",
        credit_limit=Decimal("5000"),
        rewards_type="OTHER",
        reward_program_id=1,
    )
    store = Store(
        name="Speedway",
        merchant_type="fuel",
        merchant_category="fuel",
        spending_category_id=categories["fuel"].id,
        active=True,
    )
    db.add_all([program, card, store])
    db.flush()
    card.reward_program_id = program.id
    db.add(
        CreditCardRewardRule(
            credit_card_id=card.id,
            spending_category_id=categories["fuel"].id,
            reward_type="points",
            reward_program_id=program.id,
            multiplier=Decimal("2"),
            value=Decimal("2"),
            priority=100,
        )
    )
    purchase = PurchaseBatch(
        store_name="Speedway",
        purchase_date=datetime(2026, 5, 24),
        total_amount=Decimal("100"),
        purchase_total_paid=Decimal("100"),
        credit_card_id=card.id,
    )
    db.add(purchase)
    db.flush()
    db.add(
        PurchasePayment(
            purchase_batch_id=purchase.id,
            payment_type="CREDIT_CARD",
            credit_card_id=card.id,
            amount=Decimal("100"),
        )
    )
    db.flush()

    transactions = sync_automatic_reward_transactions(db, purchase.id)

    assert len(transactions) == 1
    transaction = transactions[0]
    assert transaction.reward_type == "points"
    assert transaction.points_earned == Decimal("200")
    assert transaction.cashback_amount == Decimal("0")


def test_instant_discount_rule_can_reduce_actual_paid_before_payment_creation():
    db = make_session()
    categories = seed_categories(db)
    card = CreditCard(
        nickname="Target Circle Mastercard",
        issuer="Target",
        network="Mastercard",
        credit_limit=Decimal("5000"),
        rewards_type="OTHER",
    )
    store = Store(
        name="Target",
        merchant_type="target",
        merchant_category="target",
        spending_category_id=categories["target"].id,
        active=True,
    )
    db.add_all([card, store])
    db.flush()
    db.add(
        CreditCardRewardRule(
            credit_card_id=card.id,
            spending_category_id=categories["target"].id,
            reward_type="instant_discount_percent",
            merchant_type="target",
            multiplier=Decimal("0"),
            value=Decimal("5"),
            priority=10,
        )
    )
    purchase = PurchaseBatch(
        store_name="Target",
        purchase_date=datetime(2026, 5, 24),
        total_amount=Decimal("500"),
        purchase_total_paid=None,
        credit_card_id=card.id,
    )
    db.add(purchase)
    db.flush()

    discount = apply_purchase_discount_rule(db, purchase, card.id)

    assert discount == Decimal("25")
    assert purchase.purchase_total_paid == Decimal("475")
    assert purchase.discounts == Decimal("25")


def test_target_merchant_override_does_not_apply_to_other_funding_cards():
    db = make_session()
    categories = seed_categories(db)
    target_card = CreditCard(
        nickname="Target Circle Mastercard",
        issuer="Target",
        network="Mastercard",
        credit_limit=Decimal("5000"),
        rewards_type="OTHER",
    )
    other_card = CreditCard(
        nickname="Everyday Visa",
        issuer="Bank",
        network="Visa",
        credit_limit=Decimal("5000"),
        rewards_type="OTHER",
    )
    store = Store(
        name="Target",
        merchant_type="target",
        merchant_category="target",
        spending_category_id=categories["target"].id,
        active=True,
    )
    db.add_all([target_card, other_card, store])
    db.flush()
    db.add(
        CreditCardRewardRule(
            credit_card_id=target_card.id,
            spending_category_id=categories["target"].id,
            reward_type="instant_discount_percent",
            merchant_type="target",
            multiplier=Decimal("0"),
            value=Decimal("5"),
            priority=10,
        )
    )
    purchase = PurchaseBatch(
        store_name="Target",
        purchase_date=datetime(2026, 5, 24),
        total_amount=Decimal("500"),
        purchase_total_paid=None,
        credit_card_id=other_card.id,
    )
    db.add(purchase)
    db.flush()

    discount = apply_purchase_discount_rule(db, purchase, other_card.id)

    assert discount == Decimal("0")
    assert purchase.purchase_total_paid is None
    assert purchase.discounts is None
