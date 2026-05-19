from datetime import date, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.purchase_batch import PurchaseBatch
from app.services.barcode import decode_barcodes


router = APIRouter(prefix="/fuel-accounts", tags=["fuel-accounts"])

BARCODE_UPLOAD_DIR = Path("uploads/fuel-account-barcodes")
BARCODE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class FuelRewardAccountCreate(BaseModel):
    retailer: str
    email: str | None = None
    alt_id: str | None = None
    status: str = "ACTIVE"
    target_points: int | None = None
    barcode_image_url: str | None = None
    barcode_value: str | None = None
    notes: str | None = None


class FuelRewardAccountUpdate(BaseModel):
    retailer: str | None = None
    email: str | None = None
    alt_id: str | None = None
    status: str | None = None
    target_points: int | None = None
    barcode_image_url: str | None = None
    barcode_value: str | None = None
    notes: str | None = None


def get_payload_fields(payload: BaseModel) -> set[str]:
    return set(
        getattr(
            payload,
            "model_fields_set",
            getattr(payload, "__fields_set__", set()),
        )
    )


def account_to_dict(db: Session, account: FuelRewardAccount):
    today = date.today()
    expiration_cycle = (
        db.query(func.min(FuelPointEntry.expires_on))
        .filter(FuelPointEntry.fuel_reward_account_id == account.id)
        .scalar()
    )
    current_points = (
        db.query(func.coalesce(func.sum(FuelPointEntry.points_earned), 0))
        .filter(FuelPointEntry.fuel_reward_account_id == account.id)
        .filter(FuelPointEntry.expires_on >= today)
        .scalar()
    )
    current_points = int(current_points or 0)
    nearest_expiration_date = (
        db.query(func.min(FuelPointEntry.expires_on))
        .filter(FuelPointEntry.fuel_reward_account_id == account.id)
        .filter(FuelPointEntry.expires_on >= today)
        .scalar()
    )
    entries_count = (
        db.query(func.count(FuelPointEntry.id))
        .filter(FuelPointEntry.fuel_reward_account_id == account.id)
        .scalar()
    )
    remaining_to_target = (
        max(account.target_points - current_points, 0)
        if account.target_points is not None
        else None
    )

    return {
        "id": account.id,
        "retailer": account.retailer,
        "email": account.email,
        "alt_id": account.alt_id,
        "status": account.status,
        "target_points": account.target_points,
        "barcode_image_url": account.barcode_image_url,
        "barcode_value": account.barcode_value,
        "notes": account.notes,
        "created_at": account.created_at,
        "updated_at": account.updated_at,
        "current_points": current_points,
        "remaining_to_target": remaining_to_target,
        "nearest_expiration_date": nearest_expiration_date,
        "expiration_cycle": expiration_cycle,
        "entries_count": int(entries_count or 0),
    }


@router.get("/")
def list_fuel_accounts():
    db: Session = SessionLocal()

    try:
        accounts = (
            db.query(FuelRewardAccount)
            .order_by(FuelRewardAccount.retailer.asc())
            .all()
        )
        return [account_to_dict(db, account) for account in accounts]

    finally:
        db.close()


@router.get("/active")
def list_active_fuel_accounts():
    db: Session = SessionLocal()

    try:
        accounts = (
            db.query(FuelRewardAccount)
            .filter(FuelRewardAccount.status == "ACTIVE")
            .order_by(FuelRewardAccount.retailer.asc())
            .all()
        )
        return [account_to_dict(db, account) for account in accounts]

    finally:
        db.close()


@router.get("/dashboard")
def fuel_accounts_dashboard():
    db: Session = SessionLocal()

    try:
        accounts = (
            db.query(FuelRewardAccount)
            .order_by(FuelRewardAccount.retailer.asc())
            .all()
        )
        return [account_to_dict(db, account) for account in accounts]

    finally:
        db.close()


@router.post("/")
def create_fuel_account(payload: FuelRewardAccountCreate):
    db: Session = SessionLocal()

    try:
        account = FuelRewardAccount(
            retailer=payload.retailer,
            email=payload.email,
            alt_id=payload.alt_id,
            status=payload.status,
            target_points=payload.target_points,
            barcode_image_url=payload.barcode_image_url,
            barcode_value=payload.barcode_value,
            notes=payload.notes,
        )

        db.add(account)
        db.commit()
        db.refresh(account)

        return account_to_dict(db, account)

    finally:
        db.close()


@router.post("/{account_id}/barcode-image")
async def upload_fuel_account_barcode_image(
    account_id: int,
    file: UploadFile = File(...),
):
    extension = Path(file.filename or "").suffix
    filename = f"{uuid4()}{extension}"
    file_path = BARCODE_UPLOAD_DIR / filename

    contents = await file.read()

    with open(file_path, "wb") as f:
        f.write(contents)

    db: Session = SessionLocal()

    try:
        account = (
            db.query(FuelRewardAccount)
            .filter(FuelRewardAccount.id == account_id)
            .first()
        )

        if not account:
            raise HTTPException(status_code=404, detail="Fuel account not found")

        account.barcode_image_url = str(file_path)
        account.updated_at = datetime.utcnow()

        try:
            barcode_values = decode_barcodes(str(file_path))

            if barcode_values:
                account.barcode_value = barcode_values[0]
        except Exception as e:
            print("Fuel account barcode decode failed:", e)

        db.commit()
        db.refresh(account)

        return account_to_dict(db, account)

    finally:
        db.close()


@router.get("/{account_id}")
def get_fuel_account(account_id: int):
    db: Session = SessionLocal()

    try:
        account = (
            db.query(FuelRewardAccount)
            .filter(FuelRewardAccount.id == account_id)
            .first()
        )

        if not account:
            raise HTTPException(status_code=404, detail="Fuel account not found")

        return account_to_dict(db, account)

    finally:
        db.close()


@router.patch("/{account_id}")
def update_fuel_account(account_id: int, payload: FuelRewardAccountUpdate):
    db: Session = SessionLocal()

    try:
        account = (
            db.query(FuelRewardAccount)
            .filter(FuelRewardAccount.id == account_id)
            .first()
        )

        if not account:
            raise HTTPException(status_code=404, detail="Fuel account not found")

        for field in get_payload_fields(payload):
            setattr(account, field, getattr(payload, field))

        account.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(account)

        return account_to_dict(db, account)

    finally:
        db.close()


@router.get("/{account_id}/entries")
def list_fuel_account_entries(account_id: int):
    db: Session = SessionLocal()

    try:
        account = (
            db.query(FuelRewardAccount)
            .filter(FuelRewardAccount.id == account_id)
            .first()
        )

        if not account:
            raise HTTPException(status_code=404, detail="Fuel account not found")

        entries = (
            db.query(FuelPointEntry, PurchaseBatch)
            .join(PurchaseBatch, PurchaseBatch.id == FuelPointEntry.purchase_batch_id)
            .filter(FuelPointEntry.fuel_reward_account_id == account_id)
            .order_by(FuelPointEntry.earned_date.desc())
            .all()
        )

        return [
            {
                "id": entry.id,
                "fuel_reward_account_id": entry.fuel_reward_account_id,
                "purchase_batch_id": entry.purchase_batch_id,
                "earned_date": entry.earned_date,
                "expires_on": entry.expires_on,
                "multiplier": entry.multiplier,
                "qualifying_spend": entry.qualifying_spend,
                "points_earned": entry.points_earned,
                "notes": entry.notes,
                "created_at": entry.created_at,
                "purchase": {
                    "id": purchase.id,
                    "store_name": purchase.store_name,
                    "purchase_date": purchase.purchase_date,
                    "total_amount": purchase.total_amount,
                    "purchase_total_paid": purchase.purchase_total_paid,
                },
            }
            for entry, purchase in entries
        ]

    finally:
        db.close()
