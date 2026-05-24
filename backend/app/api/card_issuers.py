from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card_issuer import CardIssuer
from app.models.credit_card import CreditCard


router = APIRouter(prefix="/card-issuers", tags=["card-issuers"])

ISSUER_TYPES = {"bank", "credit_union", "fintech", "retail", "other"}


class CardIssuerCreate(BaseModel):
    name: str
    short_name: str | None = None
    active: bool = True
    notes: str | None = None
    website: str | None = None
    support_phone: str | None = None
    issuer_type: str | None = None


class CardIssuerUpdate(BaseModel):
    name: str | None = None
    short_name: str | None = None
    active: bool | None = None
    notes: str | None = None
    website: str | None = None
    support_phone: str | None = None
    issuer_type: str | None = None


def get_payload_fields(payload: BaseModel) -> set[str]:
    return set(
        getattr(
            payload,
            "model_fields_set",
            getattr(payload, "__fields_set__", set()),
        )
    )


def normalize_issuer_type(value: str | None) -> str | None:
    if value is None or value == "":
        return None

    normalized = value.strip().lower()
    if normalized not in ISSUER_TYPES:
        raise HTTPException(status_code=400, detail="Invalid issuer_type")
    return normalized


def serialize_issuer(issuer: CardIssuer) -> dict:
    return {
        "id": issuer.id,
        "name": issuer.name,
        "short_name": issuer.short_name,
        "active": issuer.active,
        "notes": issuer.notes,
        "website": issuer.website,
        "support_phone": issuer.support_phone,
        "issuer_type": issuer.issuer_type,
        "created_at": issuer.created_at,
        "updated_at": issuer.updated_at,
    }


@router.get("/")
def list_card_issuers(active_only: bool = False):
    db: Session = SessionLocal()

    try:
        query = db.query(CardIssuer)
        if active_only:
            query = query.filter(CardIssuer.active.is_(True))
        issuers = query.order_by(CardIssuer.name.asc()).all()
        return [serialize_issuer(issuer) for issuer in issuers]
    finally:
        db.close()


@router.post("/")
def create_card_issuer(payload: CardIssuerCreate):
    db: Session = SessionLocal()

    try:
        issuer = CardIssuer(
            name=payload.name.strip(),
            short_name=payload.short_name.strip() if payload.short_name else None,
            active=payload.active,
            notes=payload.notes,
            website=payload.website,
            support_phone=payload.support_phone,
            issuer_type=normalize_issuer_type(payload.issuer_type),
        )
        db.add(issuer)
        db.commit()
        db.refresh(issuer)
        return serialize_issuer(issuer)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Card issuer already exists") from exc
    finally:
        db.close()


@router.patch("/{issuer_id}")
def update_card_issuer(issuer_id: int, payload: CardIssuerUpdate):
    db: Session = SessionLocal()

    try:
        issuer = db.query(CardIssuer).filter(CardIssuer.id == issuer_id).first()
        if not issuer:
            raise HTTPException(status_code=404, detail="Card issuer not found")

        for field in get_payload_fields(payload):
            value = getattr(payload, field)
            if field in {"name", "short_name"} and isinstance(value, str):
                value = value.strip() or None
            if field == "issuer_type":
                value = normalize_issuer_type(value)
            setattr(issuer, field, value)

        if not issuer.name:
            raise HTTPException(status_code=400, detail="Issuer name is required")

        issuer.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(issuer)
        return serialize_issuer(issuer)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Card issuer already exists") from exc
    finally:
        db.close()


@router.delete("/{issuer_id}")
def delete_card_issuer(issuer_id: int):
    db: Session = SessionLocal()

    try:
        issuer = db.query(CardIssuer).filter(CardIssuer.id == issuer_id).first()
        if not issuer:
            raise HTTPException(status_code=404, detail="Card issuer not found")

        linked_cards = db.query(CreditCard).filter(CreditCard.issuer_id == issuer_id).count()
        if linked_cards:
            issuer.active = False
            issuer.updated_at = datetime.utcnow()
            db.commit()
            return {"deleted": False, "deactivated": True, "linked_cards": linked_cards}

        db.delete(issuer)
        db.commit()
        return {"deleted": True, "issuer_id": issuer_id}
    finally:
        db.close()
