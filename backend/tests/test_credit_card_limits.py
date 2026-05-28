from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import credit_cards
from app.api.credit_cards import resolve_configured_billing_day
from app.db.base import Base
from app.models.app_setting import AppSetting  # noqa: F401
from app.models.card_issuer import CardIssuer  # noqa: F401
from app.models.card_network import CardNetwork  # noqa: F401
from app.models.credit_card import CreditCard
from app.models.credit_card_product_change import CreditCardProductChange  # noqa: F401
from app.models.credit_card_reward_rule import CreditCardRewardRule  # noqa: F401
from app.models.credit_card_reward_transaction import CreditCardRewardTransaction  # noqa: F401
from app.models.player import Player  # noqa: F401
from app.models.purchase_batch import PurchaseBatch  # noqa: F401
from app.models.reward_program import RewardProgram  # noqa: F401
from app.models.spending_category import SpendingCategory  # noqa: F401
from app.models.store import Store  # noqa: F401


def make_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def make_client(monkeypatch, session_factory):
    monkeypatch.setattr(credit_cards, "SessionLocal", session_factory)
    app = FastAPI()
    app.include_router(credit_cards.router)
    return TestClient(app)


def card_payload(**overrides):
    payload = {
        "nickname": "Amex Gold",
        "issuer": "American Express",
        "network": "American Express",
        "credit_limit": 10_000,
    }
    payload.update(overrides)
    return payload


def test_create_credit_card_with_whole_dollar_limit(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)

    response = client.post("/credit-cards", json=card_payload(credit_limit=25_000))

    assert response.status_code == 200
    assert response.json()["credit_limit"] == 25_000
    db = session_factory()
    assert db.query(CreditCard).one().credit_limit == Decimal("25000.00")
    db.close()


def test_create_credit_card_without_preset_limit(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)

    response = client.post("/credit-cards", json=card_payload(credit_limit=None))

    assert response.status_code == 200
    body = response.json()
    assert body["credit_limit"] is None
    assert body["calculated_available_credit"] is None
    assert body["utilization_percent"] is None


def test_edit_credit_card_from_limit_to_no_preset_limit(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)
    created = client.post("/credit-cards", json=card_payload(credit_limit=5_000)).json()

    response = client.patch(
        f"/credit-cards/{created['id']}",
        json={"credit_limit": None},
    )

    assert response.status_code == 200
    assert response.json()["credit_limit"] is None
    db = session_factory()
    assert db.query(CreditCard).one().credit_limit is None
    db.close()


def test_edit_credit_card_from_no_preset_limit_to_limit(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)
    created = client.post("/credit-cards", json=card_payload(credit_limit=None)).json()

    response = client.patch(
        f"/credit-cards/{created['id']}",
        json={"credit_limit": 15_000},
    )

    assert response.status_code == 200
    assert response.json()["credit_limit"] == 15_000
    db = session_factory()
    assert db.query(CreditCard).one().credit_limit == Decimal("15000.00")
    db.close()


def test_edit_credit_card_preserves_existing_values_when_updating_days(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)
    created = client.post(
        "/credit-cards",
        json=card_payload(
            credit_limit=10_000,
            current_balance=1250,
            statement_close_day=None,
            payment_due_day=None,
        ),
    ).json()

    response = client.patch(
        f"/credit-cards/{created['id']}",
        json={"statement_close_day": 31, "payment_due_day": 15},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["credit_limit"] == 10_000
    assert body["current_balance"] == 1250
    assert body["statement_close_day"] == 31
    assert body["payment_due_day"] == 15


def test_edit_credit_card_can_clear_billing_days_without_changing_limit(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)
    created = client.post(
        "/credit-cards",
        json=card_payload(
            credit_limit=20_000,
            statement_close_day=30,
            payment_due_day=5,
        ),
    ).json()

    response = client.patch(
        f"/credit-cards/{created['id']}",
        json={"statement_close_day": None, "payment_due_day": None},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["credit_limit"] == 20_000
    assert body["statement_close_day"] is None
    assert body["payment_due_day"] is None


def test_credit_card_limit_rejects_negative_or_decimal_cents(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)

    negative = client.post("/credit-cards", json=card_payload(credit_limit=-100))
    decimal_cents = client.post(
        "/credit-cards",
        json=card_payload(nickname="Cents Card", credit_limit=5000.25),
    )

    assert negative.status_code == 422
    assert decimal_cents.status_code == 422


def test_billing_day_resolves_to_existing_calendar_day():
    assert resolve_configured_billing_day(2026, 5, 15).isoformat() == "2026-05-15"


def test_billing_day_resolves_31st_to_february_last_day():
    assert resolve_configured_billing_day(2026, 2, 31).isoformat() == "2026-02-28"


def test_billing_day_resolves_31st_to_april_last_day():
    assert resolve_configured_billing_day(2026, 4, 31).isoformat() == "2026-04-30"


def test_billing_day_resolves_31st_to_leap_year_february_last_day():
    assert resolve_configured_billing_day(2028, 2, 31).isoformat() == "2028-02-29"


def test_credit_card_billing_day_rejects_out_of_range_values(monkeypatch):
    session_factory = make_session_factory()
    client = make_client(monkeypatch, session_factory)

    low = client.post("/credit-cards", json=card_payload(statement_close_day=0))
    high = client.post("/credit-cards", json=card_payload(payment_due_day=32))

    assert low.status_code == 422
    assert high.status_code == 422
