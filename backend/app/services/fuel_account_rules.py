from datetime import date

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount


def fuel_account_current_points(
    db: Session,
    account_id: int,
    *,
    exclude_purchase_batch_id: int | None = None,
) -> int:
    query = db.query(func.coalesce(func.sum(FuelPointEntry.points_earned), 0)).filter(
        FuelPointEntry.fuel_reward_account_id == account_id,
        FuelPointEntry.expires_on >= date.today(),
    )
    if exclude_purchase_batch_id is not None:
        query = query.filter(FuelPointEntry.purchase_batch_id != exclude_purchase_batch_id)
    return int(query.scalar() or 0)


def ensure_fuel_account_can_receive_points(
    db: Session,
    account: FuelRewardAccount,
    *,
    exclude_purchase_batch_id: int | None = None,
) -> None:
    if account.status != "ACTIVE":
        raise HTTPException(
            status_code=400,
            detail="Only active fuel accounts can receive new purchase fuel points.",
        )

    current_points = fuel_account_current_points(
        db,
        account.id,
        exclude_purchase_batch_id=exclude_purchase_batch_id,
    )
    if account.target_points is not None and current_points >= account.target_points:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "fuel_account_target_reached",
                "message": (
                    f"{account.retailer} has {current_points:,} / "
                    f"{account.target_points:,} points and is available for sale only."
                ),
                "fuel_account_id": account.id,
                "current_points": current_points,
                "target_points": account.target_points,
            },
        )
