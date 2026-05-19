from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session

from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch


CENT = Decimal("0.01")


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    return Decimal(str(value))


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def recalculate_purchase_allocation(db: Session, purchase_batch_id: int):
    purchase = (
        db.query(PurchaseBatch)
        .filter(PurchaseBatch.id == purchase_batch_id)
        .first()
    )

    if not purchase:
        return None

    cards = (
        db.query(GiftCard)
        .filter(GiftCard.purchase_batch_id == purchase_batch_id)
        .order_by(GiftCard.id.asc())
        .all()
    )

    purchase_total_paid = purchase.purchase_total_paid

    if purchase_total_paid is None or not cards:
        return {
            "purchase_batch_id": purchase_batch_id,
            "purchase_total_paid": purchase_total_paid,
            "total_face_value": sum(to_decimal(card.face_value) for card in cards),
            "total_allocated_cost": sum(
                to_decimal(card.acquisition_cost) for card in cards
            ),
            "allocation_difference": Decimal("0"),
            "cards_updated": 0,
        }

    purchase_total_paid = to_decimal(purchase_total_paid)
    total_face_value = sum(to_decimal(card.face_value) for card in cards)

    if total_face_value <= 0:
        return {
            "purchase_batch_id": purchase_batch_id,
            "purchase_total_paid": purchase_total_paid,
            "total_face_value": total_face_value,
            "total_allocated_cost": sum(
                to_decimal(card.acquisition_cost) for card in cards
            ),
            "allocation_difference": purchase_total_paid,
            "cards_updated": 0,
        }

    allocated_total = Decimal("0")

    for index, card in enumerate(cards):
        if index == len(cards) - 1:
            allocated_cost = quantize_money(purchase_total_paid - allocated_total)
        else:
            ratio = to_decimal(card.face_value) / total_face_value
            allocated_cost = quantize_money(purchase_total_paid * ratio)
            allocated_total += allocated_cost

        card.acquisition_cost = allocated_cost
        card.updated_at = datetime.utcnow()

    total_allocated_cost = sum(to_decimal(card.acquisition_cost) for card in cards)

    return {
        "purchase_batch_id": purchase_batch_id,
        "purchase_total_paid": purchase_total_paid,
        "total_face_value": total_face_value,
        "total_allocated_cost": total_allocated_cost,
        "allocation_difference": quantize_money(purchase_total_paid - total_allocated_cost),
        "cards_updated": len(cards),
    }
