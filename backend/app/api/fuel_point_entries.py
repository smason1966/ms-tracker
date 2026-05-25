import calendar
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.purchase_batch import PurchaseBatch
from app.services.fuel_account_rules import ensure_fuel_account_can_receive_points


router = APIRouter(prefix="/fuel-point-entries", tags=["fuel-point-entries"])


class FuelPointEntryCreate(BaseModel):
    fuel_reward_account_id: int
    purchase_batch_id: int
    earned_date: date | None = None
    expires_on: date | None = None
    multiplier: int | None = None
    qualifying_spend: Decimal | None = None
    points_earned: int
    notes: str | None = None


def default_expires_on(earned_date: date) -> date:
    if earned_date.month == 12:
        year = earned_date.year + 1
        month = 1
    else:
        year = earned_date.year
        month = earned_date.month + 1

    last_day = calendar.monthrange(year, month)[1]

    return date(year, month, last_day)


def format_expiration_date(value: date) -> str:
    return f"{value.strftime('%b')} {value.day}, {value.year}"


def get_purchase_earned_date(purchase: PurchaseBatch) -> date:
    purchase_date = purchase.purchase_date

    if isinstance(purchase_date, datetime):
        return purchase_date.date()

    if isinstance(purchase_date, date):
        return purchase_date

    raise ValueError("Purchase batch has an invalid purchase_date")


@router.post("/")
def create_fuel_point_entry(payload: FuelPointEntryCreate):
    db: Session = SessionLocal()

    try:
        account = (
            db.query(FuelRewardAccount)
            .filter(FuelRewardAccount.id == payload.fuel_reward_account_id)
            .first()
        )

        if not account:
            raise HTTPException(status_code=404, detail="Fuel account not found")

        ensure_fuel_account_can_receive_points(db, account)

        purchase = (
            db.query(PurchaseBatch)
            .filter(PurchaseBatch.id == payload.purchase_batch_id)
            .first()
        )

        if not purchase:
            raise HTTPException(status_code=404, detail="Purchase batch not found")

        earned_date = get_purchase_earned_date(purchase)
        expires_on = default_expires_on(earned_date)
        existing_expiration = (
            db.query(FuelPointEntry.expires_on)
            .filter(FuelPointEntry.fuel_reward_account_id == account.id)
            .order_by(FuelPointEntry.expires_on.asc())
            .first()
        )

        if existing_expiration:
            expiration_cycle = existing_expiration[0]

            if (
                expiration_cycle.year != expires_on.year
                or expiration_cycle.month != expires_on.month
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "This account is locked to points expiring "
                        f"{format_expiration_date(expiration_cycle)}."
                    ),
                )

        entry = FuelPointEntry(
            fuel_reward_account_id=payload.fuel_reward_account_id,
            purchase_batch_id=payload.purchase_batch_id,
            earned_date=earned_date,
            expires_on=expires_on,
            multiplier=payload.multiplier,
            qualifying_spend=payload.qualifying_spend,
            points_earned=payload.points_earned,
            notes=payload.notes,
        )

        db.add(entry)
        db.commit()
        db.refresh(entry)

        current_points = (
            db.query(func.coalesce(func.sum(FuelPointEntry.points_earned), 0))
            .filter(FuelPointEntry.fuel_reward_account_id == account.id)
            .filter(FuelPointEntry.expires_on >= date.today())
            .scalar()
        )
        current_points = int(current_points or 0)

        return {
            "entry": entry,
            "account_current_points": current_points,
            "target_points": account.target_points,
            "target_met": bool(
                account.target_points is not None
                and current_points >= account.target_points
            ),
        }

    finally:
        db.close()
