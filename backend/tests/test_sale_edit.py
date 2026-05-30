import os
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("MS_TRACKER_UPLOADS_DIR", "/private/tmp/ms-tracker-test-uploads")

from app.api import sales
from app.db.base import Base
from app.models.buyer import Buyer
from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch
from app.models.sale import Sale
from app.models.sale_gift_card import SaleGiftCard
from scripts.encrypt_sensitive_fields import initialize_model_registry


def make_session_factory():
    initialize_model_registry()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def seed_imported_sale(session_factory):
    db = session_factory()
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=datetime(2026, 5, 1),
        total_amount=Decimal("200.00"),
        purchase_total_paid=Decimal("180.00"),
    )
    buyer = Buyer(name="Imported Buyer")
    db.add_all([purchase, buyer])
    db.commit()

    first_card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value=Decimal("100.00"),
        acquisition_cost=Decimal("90.00"),
        status="SOLD_PENDING_PAYMENT",
        expected_payout=Decimal("80.00"),
        sale_price=Decimal("80.00"),
        buyer_id=buyer.id,
        sold_to=buyer.name,
    )
    second_card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value=Decimal("100.00"),
        acquisition_cost=Decimal("90.00"),
        status="SOLD_PENDING_PAYMENT",
        expected_payout=Decimal("20.00"),
        sale_price=Decimal("20.00"),
        buyer_id=buyer.id,
        sold_to=buyer.name,
    )
    db.add_all([first_card, second_card])
    db.commit()

    sale = Sale(
        buyer_id=buyer.id,
        expected_payout=Decimal("100.00"),
        status="SOLD_PENDING_PAYMENT",
        imported_from_environment="test",
        imported_source_id="42",
    )
    db.add(sale)
    db.commit()

    first_link = SaleGiftCard(
        sale_id=sale.id,
        gift_card_id=first_card.id,
        expected_payout=Decimal("80.00"),
    )
    second_link = SaleGiftCard(
        sale_id=sale.id,
        gift_card_id=second_card.id,
        expected_payout=Decimal("20.00"),
    )
    db.add_all([first_link, second_link])
    db.commit()

    sale_id = sale.id
    card_ids = [first_card.id, second_card.id]
    db.close()
    return sale_id, card_ids


def test_edit_imported_sale_expected_payout_reallocates_linked_cards(monkeypatch):
    session_factory = make_session_factory()
    sale_id, card_ids = seed_imported_sale(session_factory)
    monkeypatch.setattr(sales, "SessionLocal", session_factory)

    updated = sales.edit_sale(
        sale_id,
        sales.SaleEdit(
            expected_payout=Decimal("110.00"),
            reason="Correct imported sale price",
        ),
    )

    assert updated["expected_payout"] == Decimal("110.00")
    assert [card["expected_payout"] for card in updated["gift_cards"]] == [
        Decimal("88.00"),
        Decimal("22.00"),
    ]

    db = session_factory()
    try:
        sale = db.query(Sale).filter(Sale.id == sale_id).one()
        links = (
            db.query(SaleGiftCard)
            .filter(SaleGiftCard.sale_id == sale_id)
            .order_by(SaleGiftCard.id.asc())
            .all()
        )
        cards = (
            db.query(GiftCard)
            .filter(GiftCard.id.in_(card_ids))
            .order_by(GiftCard.id.asc())
            .all()
        )
        assert sale.expected_payout == Decimal("110.00")
        assert [link.expected_payout for link in links] == [
            Decimal("88.00"),
            Decimal("22.00"),
        ]
        assert [card.sale_price for card in cards] == [
            Decimal("88.00"),
            Decimal("22.00"),
        ]
        assert [card.expected_payout for card in cards] == [
            Decimal("88.00"),
            Decimal("22.00"),
        ]
    finally:
        db.close()


def test_edit_sale_expected_payout_requires_user_reason(monkeypatch):
    session_factory = make_session_factory()
    sale_id, _ = seed_imported_sale(session_factory)
    monkeypatch.setattr(sales, "SessionLocal", session_factory)

    try:
        sales.edit_sale(sale_id, sales.SaleEdit(expected_payout=Decimal("110.00")))
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail["error"] == "edit_reason_required"
        assert "reason is required" in exc.detail["message"]
    else:
        raise AssertionError("Expected payout edit without reason to be rejected")
