import logging
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.db.session import SessionLocal
from app.models.card_image import CardImage
from app.models.credit_card import CreditCard
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_candidate import ExtractionCandidate
from app.models.extraction_profile_metric import ExtractionProfileMetric
from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch
from app.models.purchase_payment import PurchasePayment
from app.models.receipt import Receipt
from app.models.sale import Sale
from app.models.sale_event import SaleEvent
from app.models.sale_fuel_account import SaleFuelAccount
from app.models.sale_gift_card import SaleGiftCard
from app.models.store import Store
from app.api.purchase_payments import PurchasePaymentCreate, create_purchase_payment
from app.models.credit_card_reward_transaction import CreditCardRewardTransaction
from app.services.operational_queues import get_purchases_needing_receipts
from app.services.credit_card_rewards import (
    replace_with_manual_reward_override,
    serialize_reward_transaction,
    sync_automatic_reward_transactions,
)
from app.services.purchase_allocation import recalculate_purchase_allocation


router = APIRouter(prefix="/purchase-batches", tags=["purchase-batches"])
FINANCIALLY_INACTIVE_CARD_STATUSES = {"VOID", "VOIDED", "ARCHIVED"}
logger = logging.getLogger(__name__)


class PurchaseBatchCreate(BaseModel):
    store_name: str
    purchase_date: datetime
    total_amount: Decimal
    purchase_total_paid: Decimal | None = None
    sales_tax: Decimal | None = None
    activation_fees: Decimal | None = None
    discounts: Decimal | None = None
    fuel_point_estimated_value: Decimal | None = None
    fuel_points_quantity: int | None = None
    fuel_points_unit: int | None = None
    fuel_points_notes: str | None = None
    financial_notes: str | None = None
    notes: str | None = None
    credit_card_id: int | None = None
    player_id: int | None = None


class PurchaseBatchUpdate(BaseModel):
    purchase_total_paid: Decimal | None = None
    sales_tax: Decimal | None = None
    activation_fees: Decimal | None = None
    discounts: Decimal | None = None
    fuel_point_estimated_value: Decimal | None = None
    fuel_points_quantity: int | None = None
    fuel_points_unit: int | None = None
    fuel_points_notes: str | None = None
    financial_notes: str | None = None
    notes: str | None = None
    credit_card_id: int | None = None
    player_id: int | None = None


class RewardTransactionOverride(BaseModel):
    credit_card_id: int | None = None
    reward_program_id: int | None = None
    spending_category_id: int | None = None
    qualifying_spend: Decimal
    multiplier: Decimal
    rewards_earned: Decimal
    notes: str | None = None


def get_payload_fields(payload: BaseModel) -> set[str]:
    return set(
        getattr(
            payload,
            "model_fields_set",
            getattr(payload, "__fields_set__", set()),
        )
    )


def apply_credit_card_purchase_delta(
    db: Session,
    credit_card_id: int | None,
    amount: Decimal,
) -> None:
    if credit_card_id is None or amount == 0:
        return

    card = db.query(CreditCard).filter(CreditCard.id == credit_card_id).first()

    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    card.current_spend_progress = Decimal(card.current_spend_progress or 0) + amount
    card.current_balance = Decimal(card.current_balance or 0) + amount
    card.updated_at = datetime.utcnow()


def infer_player_id_from_credit_card(db: Session, credit_card_id: int | None) -> int | None:
    if credit_card_id is None:
        return None

    card = db.query(CreditCard).filter(CreditCard.id == credit_card_id).first()

    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    return card.player_id


def serialize_fuel_point_entry(
    entry: FuelPointEntry,
    account: FuelRewardAccount | None,
) -> dict:
    return {
        "id": entry.id,
        "fuel_reward_account_id": entry.fuel_reward_account_id,
        "purchase_batch_id": entry.purchase_batch_id,
        "earned_date": entry.earned_date,
        "expires_on": entry.expires_on,
        "multiplier": entry.multiplier,
        "qualifying_spend": entry.qualifying_spend,
        "points_earned": entry.points_earned,
        "entry_type": entry.entry_type,
        "notes": entry.notes,
        "created_at": entry.created_at,
        "fuel_account": (
            {
                "id": account.id,
                "retailer": account.retailer,
                "email": account.email,
                "alt_id": account.alt_id,
                "status": account.status,
                "target_points": account.target_points,
            }
            if account
            else None
        ),
    }


def serialize_purchase_batch(db: Session, batch: PurchaseBatch) -> dict:
    calculated_card_face_value = (
        db.query(func.coalesce(func.sum(GiftCard.face_value), 0))
        .filter(GiftCard.purchase_batch_id == batch.id)
        .filter(~GiftCard.status.in_(FINANCIALLY_INACTIVE_CARD_STATUSES))
        .scalar()
    )
    card_count = (
        db.query(func.count(GiftCard.id))
        .filter(GiftCard.purchase_batch_id == batch.id)
        .filter(~GiftCard.status.in_(FINANCIALLY_INACTIVE_CARD_STATUSES))
        .scalar()
    )
    receipt_count = (
        db.query(func.count(Receipt.id))
        .filter(Receipt.purchase_batch_id == batch.id)
        .scalar()
    )
    store = db.query(Store).filter(Store.name == batch.store_name).first()
    fuel_entries = (
        db.query(FuelPointEntry, FuelRewardAccount)
        .outerjoin(
            FuelRewardAccount,
            FuelRewardAccount.id == FuelPointEntry.fuel_reward_account_id,
        )
        .filter(FuelPointEntry.purchase_batch_id == batch.id)
        .order_by(FuelPointEntry.created_at.desc())
        .all()
    )
    reward_transactions = (
        db.query(CreditCardRewardTransaction)
        .filter(CreditCardRewardTransaction.purchase_id == batch.id)
        .order_by(CreditCardRewardTransaction.created_at.desc())
        .all()
    )

    return {
        "id": batch.id,
        "store_name": batch.store_name,
        "purchase_date": batch.purchase_date,
        "total_amount": batch.total_amount,
        "purchase_total_paid": batch.purchase_total_paid,
        "sales_tax": batch.sales_tax,
        "activation_fees": batch.activation_fees,
        "discounts": batch.discounts,
        "fuel_point_estimated_value": batch.fuel_point_estimated_value,
        "fuel_points_quantity": batch.fuel_points_quantity,
        "fuel_points_unit": batch.fuel_points_unit,
        "fuel_points_notes": batch.fuel_points_notes,
        "financial_notes": batch.financial_notes,
        "notes": batch.notes,
        "credit_card_id": batch.credit_card_id,
        "player_id": batch.player_id,
        "created_at": batch.created_at,
        "updated_at": batch.updated_at,
        "calculated_card_face_value": calculated_card_face_value,
        "card_count": int(card_count or 0),
        "receipt_count": int(receipt_count or 0),
        "store_earns_fuel_points": bool(store.earns_fuel_points) if store else False,
        "store_default_fuel_multiplier": store.default_fuel_multiplier if store else None,
        "spending_category_id": store.spending_category_id if store else None,
        "merchant_category": store.merchant_category if store else None,
        "fuel_point_entries": [
            serialize_fuel_point_entry(entry, account)
            for entry, account in fuel_entries
        ],
        "reward_transactions": [
            serialize_reward_transaction(db, transaction)
            for transaction in reward_transactions
        ],
    }


def purchase_delete_report(db: Session, batch: PurchaseBatch) -> dict:
    cards = (
        db.query(GiftCard)
        .filter(GiftCard.purchase_batch_id == batch.id)
        .order_by(GiftCard.id.asc())
        .all()
    )
    card_ids = [card.id for card in cards]
    fuel_entries = (
        db.query(FuelPointEntry, FuelRewardAccount)
        .join(
            FuelRewardAccount,
            FuelRewardAccount.id == FuelPointEntry.fuel_reward_account_id,
        )
        .filter(FuelPointEntry.purchase_batch_id == batch.id)
        .all()
    )
    fuel_account_ids = sorted({account.id for _, account in fuel_entries})
    blocking_dependencies: list[dict] = []
    warnings: list[str] = []

    sale_rows = []
    if card_ids:
        sale_rows = (
            db.query(SaleGiftCard, Sale)
            .join(Sale, Sale.id == SaleGiftCard.sale_id)
            .filter(SaleGiftCard.gift_card_id.in_(card_ids))
            .all()
        )

    exported_sale_ids = {
        sale_id
        for (sale_id,) in db.query(SaleEvent.sale_id)
        .filter(SaleEvent.sale_id.in_([sale.id for _, sale in sale_rows] or [-1]))
        .filter(SaleEvent.action == "exported")
        .all()
    }

    sale_links: list[dict] = []
    for sale_link, sale in sale_rows:
        sale_status = (sale.status or "").upper()
        exported = sale.id in exported_sale_ids
        settled = bool(sale_link.settlement_received_at or sale_link.payout_received)
        link = {
            "gift_card_id": sale_link.gift_card_id,
            "sale_id": sale.id,
            "status": sale_status,
            "exported": exported,
            "settled": settled,
            "blocking": False,
        }

        if sale_status == "VOIDED":
            warnings.append(
                f"Voided Sale #{sale.id} card link will be removed."
            )
        elif settled or sale_status in {"SETTLED", "COMPLETED"}:
            link["blocking"] = True
            blocking_dependencies.append(
                {
                    "type": "settled_sale",
                    "gift_card_id": sale_link.gift_card_id,
                    "sale_id": sale.id,
                    "message": (
                        "Cannot delete: card "
                        f"#{sale_link.gift_card_id} belongs to settled Sale #{sale.id}"
                    ),
                }
            )
        elif exported:
            link["blocking"] = True
            blocking_dependencies.append(
                {
                    "type": "exported_sale",
                    "gift_card_id": sale_link.gift_card_id,
                    "sale_id": sale.id,
                    "message": (
                        "Cannot delete: card "
                        f"#{sale_link.gift_card_id} was exported in Sale #{sale.id}"
                    ),
                }
            )
        else:
            link["blocking"] = True
            blocking_dependencies.append(
                {
                    "type": "active_sale",
                    "gift_card_id": sale_link.gift_card_id,
                    "sale_id": sale.id,
                    "message": (
                        "Cannot delete: card "
                        f"#{sale_link.gift_card_id} is linked to active Sale #{sale.id}"
                    ),
                }
            )

        sale_links.append(link)

    for card in cards:
        card_status = (card.status or "").upper()
        card_sale_links = [link for link in sale_links if link["gift_card_id"] == card.id]
        has_only_voided_sale_links = bool(card_sale_links) and all(
            link["status"] == "VOIDED" for link in card_sale_links
        )

        if (
            card_status in {"SOLD", "SOLD_PENDING_PAYMENT", "SETTLED"}
            and not has_only_voided_sale_links
        ):
            blocking_dependencies.append(
                {
                    "type": "sold_card_status",
                    "gift_card_id": card.id,
                    "message": (
                        "Cannot delete: card "
                        f"#{card.id} status is {card_status}"
                    ),
                }
            )
        elif card_status in {"SOLD", "SOLD_PENDING_PAYMENT", "SETTLED"}:
            warnings.append(
                f"Card #{card.id} has stale {card_status} status but only voided sale links."
            )

    fuel_sale_links: list[dict] = []
    if fuel_account_ids:
        fuel_sale_rows = (
            db.query(SaleFuelAccount, Sale)
            .join(Sale, Sale.id == SaleFuelAccount.sale_id)
            .filter(SaleFuelAccount.fuel_reward_account_id.in_(fuel_account_ids))
            .all()
        )
        for row, sale in fuel_sale_rows:
            sale_status = (sale.status or "").upper()
            link = {
                "fuel_reward_account_id": row.fuel_reward_account_id,
                "sale_id": sale.id,
                "status": sale_status,
                "settled": bool(row.settlement_received_at or row.payout_received),
                "blocking": sale_status != "VOIDED",
            }
            if sale_status != "VOIDED":
                blocking_dependencies.append(
                    {
                        "type": "fuel_account_sale",
                        "fuel_reward_account_id": row.fuel_reward_account_id,
                        "sale_id": sale.id,
                        "message": (
                            "Cannot delete: fuel account "
                            f"#{row.fuel_reward_account_id} is linked to Sale #{sale.id}"
                        ),
                    }
                )
            fuel_sale_links.append(link)

    for _, account in fuel_entries:
        if (account.status or "").upper() == "SOLD":
            blocking_dependencies.append(
                {
                    "type": "sold_fuel_account",
                    "fuel_reward_account_id": account.id,
                    "message": f"Cannot delete: fuel account #{account.id} was sold",
                }
            )

    extraction_attempt_ids = [
        attempt_id
        for (attempt_id,) in db.query(ExtractionAttempt.id)
        .filter(ExtractionAttempt.gift_card_id.in_(card_ids or [-1]))
        .all()
    ]
    payment_lines = (
        db.query(PurchasePayment)
        .filter(PurchasePayment.purchase_batch_id == batch.id)
        .all()
    )

    return {
        "purchase_batch_id": batch.id,
        "can_delete": not blocking_dependencies,
        "blocking_dependencies": blocking_dependencies,
        "warnings": warnings,
        "impact": {
            "gift_cards_to_delete": len(card_ids),
            "receipts_to_delete": db.query(func.count(Receipt.id))
            .filter(Receipt.purchase_batch_id == batch.id)
            .scalar(),
            "fuel_point_entries_to_delete": len(fuel_entries),
            "fuel_points_to_reverse": sum(entry.points_earned for entry, _ in fuel_entries),
            "payment_lines_to_remove": len(payment_lines),
            "credit_card_payment_amount_to_reverse": str(
                sum(
                    to_decimal(payment.amount)
                    for payment in payment_lines
                    if payment.payment_type == "CREDIT_CARD"
                )
            ),
            "reward_transactions_to_delete": db.query(
                func.count(CreditCardRewardTransaction.id)
            )
            .filter(CreditCardRewardTransaction.purchase_id == batch.id)
            .scalar(),
            "ocr_attempts_to_delete": len(extraction_attempt_ids),
            "ocr_candidates_to_delete": db.query(func.count(ExtractionCandidate.id))
            .filter(ExtractionCandidate.gift_card_id.in_(card_ids or [-1]))
            .scalar(),
            "ocr_metrics_to_delete": db.query(func.count(ExtractionProfileMetric.id))
            .filter(ExtractionProfileMetric.gift_card_id.in_(card_ids or [-1]))
            .scalar(),
            "card_images_to_delete": db.query(func.count(CardImage.id))
            .filter(CardImage.gift_card_id.in_(card_ids or [-1]))
            .scalar(),
        },
        "sale_links": sale_links,
        "fuel_sale_links": fuel_sale_links,
        "gift_card_ids": card_ids,
        "fuel_account_ids": fuel_account_ids,
    }


def purchase_delete_blocked_response(report: dict) -> HTTPException:
    first_blocker = (
        report["blocking_dependencies"][0]["message"]
        if report["blocking_dependencies"]
        else "Cannot delete purchase."
    )
    return HTTPException(
        status_code=409,
        detail={
            "error": "purchase_delete_blocked",
            "message": first_blocker,
            "delete_report": report,
        },
    )


@router.post("/")
def create_purchase_batch(payload: PurchaseBatchCreate):
    db: Session = SessionLocal()

    try:
        inferred_player_id = (
            payload.player_id
            if payload.player_id is not None
            else infer_player_id_from_credit_card(db, payload.credit_card_id)
        )
        batch = PurchaseBatch(
            store_name=payload.store_name,
            purchase_date=payload.purchase_date,
            total_amount=payload.total_amount,
            purchase_total_paid=payload.purchase_total_paid,
            sales_tax=payload.sales_tax,
            activation_fees=payload.activation_fees,
            discounts=payload.discounts,
            fuel_point_estimated_value=payload.fuel_point_estimated_value,
            fuel_points_quantity=payload.fuel_points_quantity,
            fuel_points_unit=payload.fuel_points_unit,
            fuel_points_notes=payload.fuel_points_notes,
            financial_notes=payload.financial_notes,
            notes=payload.notes,
            credit_card_id=payload.credit_card_id,
            player_id=inferred_player_id,
        )
        db.add(batch)
        db.flush()

        if payload.credit_card_id and payload.purchase_total_paid:
            create_purchase_payment(
                db,
                batch.id,
                PurchasePaymentCreate(
                    payment_type="CREDIT_CARD",
                    credit_card_id=payload.credit_card_id,
                    amount=payload.purchase_total_paid,
                    notes="Created from funding card",
                ),
            )
            sync_automatic_reward_transactions(db, batch.id)

        db.commit()
        db.refresh(batch)
        return serialize_purchase_batch(db, batch)
    finally:
        db.close()


@router.get("/")
def list_purchase_batches():
    db: Session = SessionLocal()

    try:
        batches = db.query(PurchaseBatch).order_by(PurchaseBatch.created_at.desc()).all()
        return [serialize_purchase_batch(db, batch) for batch in batches]
    finally:
        db.close()


@router.get("/receipt-audit")
def list_purchase_batches_needing_receipts():
    db: Session = SessionLocal()

    try:
        purchases = get_purchases_needing_receipts(db)
        purchases.sort(
            key=lambda purchase: (purchase.purchase_date, purchase.id),
            reverse=True,
        )
        return [serialize_purchase_batch(db, batch) for batch in purchases]
    finally:
        db.close()
        
@router.get("/{purchase_batch_id}")
def get_purchase_batch(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        batch = (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == purchase_batch_id)
            .first()
        )

        if not batch:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        return serialize_purchase_batch(db, batch)

    finally:
        db.close()


@router.get("/{purchase_batch_id}/delete-report")
def get_purchase_delete_report(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        batch = (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == purchase_batch_id)
            .first()
        )

        if not batch:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        return purchase_delete_report(db, batch)
    finally:
        db.close()


@router.delete("/{purchase_batch_id}")
def delete_purchase_batch(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        batch = (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == purchase_batch_id)
            .first()
        )

        if not batch:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        delete_report = purchase_delete_report(db, batch)
        if not delete_report["can_delete"]:
            raise purchase_delete_blocked_response(delete_report)

        cards = (
            db.query(GiftCard)
            .filter(GiftCard.purchase_batch_id == purchase_batch_id)
            .all()
        )
        card_ids = [card.id for card in cards]

        if card_ids:
            extraction_attempt_ids = [
                attempt_id
                for (attempt_id,) in db.query(ExtractionAttempt.id)
                .filter(ExtractionAttempt.gift_card_id.in_(card_ids))
                .all()
            ]

            db.query(ExtractionCandidate).filter(
                ExtractionCandidate.gift_card_id.in_(card_ids)
            ).delete(synchronize_session=False)

            if extraction_attempt_ids:
                db.query(ExtractionCandidate).filter(
                    ExtractionCandidate.extraction_attempt_id.in_(
                        extraction_attempt_ids
                    )
                ).delete(synchronize_session=False)

                db.query(ExtractionProfileMetric).filter(
                    ExtractionProfileMetric.extraction_attempt_id.in_(
                        extraction_attempt_ids
                    )
                ).delete(synchronize_session=False)

            db.query(ExtractionProfileMetric).filter(
                ExtractionProfileMetric.gift_card_id.in_(card_ids)
            ).delete(synchronize_session=False)
            db.query(ExtractionAttempt).filter(
                ExtractionAttempt.gift_card_id.in_(card_ids)
            ).delete(synchronize_session=False)
            db.query(CardImage).filter(CardImage.gift_card_id.in_(card_ids)).delete(
                synchronize_session=False
            )
            db.query(SaleGiftCard).filter(SaleGiftCard.gift_card_id.in_(card_ids)).delete(
                synchronize_session=False
            )
            db.query(GiftCard).filter(GiftCard.id.in_(card_ids)).delete(
                synchronize_session=False
            )

        payment_lines = (
            db.query(PurchasePayment)
            .filter(PurchasePayment.purchase_batch_id == purchase_batch_id)
            .all()
        )
        for payment in payment_lines:
            if payment.payment_type == "CREDIT_CARD":
                apply_credit_card_purchase_delta(
                    db,
                    payment.credit_card_id,
                    -to_decimal(payment.amount),
                )

        db.query(CreditCardRewardTransaction).filter(
            CreditCardRewardTransaction.purchase_id == purchase_batch_id
        ).delete(synchronize_session=False)
        db.query(Receipt).filter(Receipt.purchase_batch_id == purchase_batch_id).delete(
            synchronize_session=False
        )
        db.query(FuelPointEntry).filter(
            FuelPointEntry.purchase_batch_id == purchase_batch_id
        ).delete(synchronize_session=False)
        db.query(PurchasePayment).filter(
            PurchasePayment.purchase_batch_id == purchase_batch_id
        ).delete(synchronize_session=False)
        logger.info(
            "Purchase deleted; assets and rewards rolled back.",
            extra={
                "purchase_batch_id": purchase_batch_id,
                "delete_report": delete_report,
            },
        )
        db.delete(batch)
        db.commit()

        return {
            "deleted": True,
            "purchase_batch_id": purchase_batch_id,
            "deleted_gift_cards": len(card_ids),
            "delete_report": delete_report,
            "message": "Purchase and unsold related records deleted.",
        }
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        logger.exception(
            "Purchase delete blocked by database integrity dependency",
            extra={"purchase_batch_id": purchase_batch_id},
        )
        raise HTTPException(
            status_code=409,
            detail={
                "error": "purchase_delete_integrity_dependency",
                "message": (
                    "Cannot delete: a related downstream dependency still exists. "
                    "Review backend logs for the database constraint name."
                ),
                "purchase_batch_id": purchase_batch_id,
                "developer_detail": str(getattr(exc, "orig", exc)),
            },
        )
    except Exception:
        db.rollback()
        logger.exception(
            "Purchase delete failed",
            extra={"purchase_batch_id": purchase_batch_id},
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "purchase_delete_failed",
                "message": "Purchase delete failed unexpectedly. Check backend logs.",
                "purchase_batch_id": purchase_batch_id,
            },
        )
    finally:
        db.close()


@router.patch("/{purchase_batch_id}/recalculate-allocation")
def recalculate_allocation(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        allocation = recalculate_purchase_allocation(db, purchase_batch_id)

        if allocation is None:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        db.commit()

        return allocation

    finally:
        db.close()


@router.patch("/{purchase_batch_id}")
def update_purchase_batch(purchase_batch_id: int, payload: PurchaseBatchUpdate):
    db: Session = SessionLocal()

    try:
        batch = (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == purchase_batch_id)
            .first()
        )

        if not batch:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        payload_fields = get_payload_fields(payload)
        for field in payload_fields:
            setattr(batch, field, getattr(payload, field))

        if "credit_card_id" in payload_fields and "player_id" not in payload_fields:
            batch.player_id = infer_player_id_from_credit_card(db, payload.credit_card_id)

        batch.updated_at = datetime.utcnow()

        if "purchase_total_paid" in payload_fields:
            recalculate_purchase_allocation(db, purchase_batch_id)

        sync_automatic_reward_transactions(db, purchase_batch_id)

        db.commit()
        db.refresh(batch)

        return serialize_purchase_batch(db, batch)

    finally:
        db.close()


@router.post("/{purchase_batch_id}/reward-transaction/manual-override")
def override_purchase_rewards(
    purchase_batch_id: int,
    payload: RewardTransactionOverride,
):
    db: Session = SessionLocal()

    try:
        transaction = replace_with_manual_reward_override(
            db,
            purchase_id=purchase_batch_id,
            credit_card_id=payload.credit_card_id,
            reward_program_id=payload.reward_program_id,
            spending_category_id=payload.spending_category_id,
            qualifying_spend=payload.qualifying_spend,
            multiplier=payload.multiplier,
            rewards_earned=payload.rewards_earned,
            notes=payload.notes,
        )
        db.commit()
        db.refresh(transaction)
        return serialize_reward_transaction(db, transaction)
    finally:
        db.close()


@router.post("/{purchase_batch_id}/reward-transaction/recalculate")
def recalculate_purchase_rewards(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        batch = (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == purchase_batch_id)
            .first()
        )

        if not batch:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        transactions = sync_automatic_reward_transactions(db, purchase_batch_id)
        db.commit()
        return {
            "recalculated": True,
            "transaction_count": len(transactions),
            "reward_transactions": [
                serialize_reward_transaction(db, transaction)
                for transaction in transactions
            ],
        }
    finally:
        db.close()
