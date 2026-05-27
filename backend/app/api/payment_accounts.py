from datetime import datetime
from app.utils.time import utc_now

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.payment_account import PaymentAccount


router = APIRouter(prefix="/payment-accounts", tags=["payment-accounts"])


class PaymentAccountCreate(BaseModel):
    name: str
    account_type: str
    institution: str | None = None
    last_four: str | None = None
    account_identifier: str | None = None
    payment_identifier: str | None = None
    is_business_account: bool = False
    bank_account_type: str | None = None
    notes: str | None = None
    active: bool = True


class PaymentAccountUpdate(BaseModel):
    name: str | None = None
    account_type: str | None = None
    institution: str | None = None
    last_four: str | None = None
    account_identifier: str | None = None
    payment_identifier: str | None = None
    is_business_account: bool | None = None
    bank_account_type: str | None = None
    notes: str | None = None
    active: bool | None = None


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None

    cleaned = value.strip()
    return cleaned or None


def serialize_payment_account(account: PaymentAccount) -> dict:
    payment_identifier = account.payment_identifier or account.account_identifier

    return {
        "id": account.id,
        "name": account.name,
        "account_type": account.account_type,
        "institution": account.institution,
        "last_four": account.last_four,
        "account_identifier": account.account_identifier,
        "payment_identifier": payment_identifier,
        "is_business_account": account.is_business_account,
        "bank_account_type": account.bank_account_type,
        "notes": account.notes,
        "active": account.active,
        "created_at": account.created_at,
        "updated_at": account.updated_at,
    }


def get_payment_account_or_404(db: Session, account_id: int) -> PaymentAccount:
    account = db.query(PaymentAccount).filter(PaymentAccount.id == account_id).first()

    if not account:
        raise HTTPException(status_code=404, detail="Payment account not found")

    return account


@router.get("/")
def list_payment_accounts(active_only: bool = False):
    db: Session = SessionLocal()

    try:
        query = db.query(PaymentAccount)

        if active_only:
            query = query.filter(PaymentAccount.active.is_(True))

        accounts = query.order_by(PaymentAccount.active.desc(), PaymentAccount.name.asc()).all()
        return [serialize_payment_account(account) for account in accounts]
    finally:
        db.close()


@router.post("/")
def create_payment_account(payload: PaymentAccountCreate):
    db: Session = SessionLocal()

    try:
        payment_identifier = clean_text(
            payload.payment_identifier or payload.account_identifier,
        )
        account = PaymentAccount(
            name=payload.name.strip(),
            account_type=payload.account_type.strip(),
            institution=clean_text(payload.institution),
            last_four=clean_text(payload.last_four),
            account_identifier=payment_identifier,
            payment_identifier=payment_identifier,
            is_business_account=payload.is_business_account,
            bank_account_type=clean_text(payload.bank_account_type),
            notes=clean_text(payload.notes),
            active=payload.active,
        )
        db.add(account)
        db.commit()
        db.refresh(account)
        return serialize_payment_account(account)
    finally:
        db.close()


@router.get("/{account_id}")
def get_payment_account(account_id: int):
    db: Session = SessionLocal()

    try:
        return serialize_payment_account(get_payment_account_or_404(db, account_id))
    finally:
        db.close()


@router.patch("/{account_id}")
def update_payment_account(account_id: int, payload: PaymentAccountUpdate):
    db: Session = SessionLocal()

    try:
        account = get_payment_account_or_404(db, account_id)
        update_data = payload.model_dump(exclude_unset=True)

        for field, value in update_data.items():
            cleaned_value = clean_text(value) if isinstance(value, str) else value
            setattr(account, field, cleaned_value)

            if field == "payment_identifier":
                account.account_identifier = cleaned_value
            elif field == "account_identifier":
                account.payment_identifier = cleaned_value

        account.updated_at = utc_now()
        db.commit()
        db.refresh(account)
        return serialize_payment_account(account)
    finally:
        db.close()
