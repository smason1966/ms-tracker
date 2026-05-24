from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card_network import CardNetwork
from app.models.credit_card import CreditCard


router = APIRouter(prefix="/card-networks", tags=["card-networks"])


class CardNetworkCreate(BaseModel):
    name: str
    code: str
    active: bool = True
    notes: str | None = None


class CardNetworkUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    active: bool | None = None
    notes: str | None = None


def get_payload_fields(payload: BaseModel) -> set[str]:
    return set(
        getattr(
            payload,
            "model_fields_set",
            getattr(payload, "__fields_set__", set()),
        )
    )


def serialize_network(network: CardNetwork) -> dict:
    return {
        "id": network.id,
        "name": network.name,
        "code": network.code,
        "active": network.active,
        "notes": network.notes,
        "created_at": network.created_at,
        "updated_at": network.updated_at,
    }


@router.get("/")
def list_card_networks(active_only: bool = False):
    db: Session = SessionLocal()

    try:
        query = db.query(CardNetwork)
        if active_only:
            query = query.filter(CardNetwork.active.is_(True))
        networks = query.order_by(CardNetwork.name.asc()).all()
        return [serialize_network(network) for network in networks]
    finally:
        db.close()


@router.post("/")
def create_card_network(payload: CardNetworkCreate):
    db: Session = SessionLocal()

    try:
        network = CardNetwork(
            name=payload.name.strip(),
            code=payload.code.strip().upper(),
            active=payload.active,
            notes=payload.notes,
        )
        db.add(network)
        db.commit()
        db.refresh(network)
        return serialize_network(network)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Card network already exists") from exc
    finally:
        db.close()


@router.patch("/{network_id}")
def update_card_network(network_id: int, payload: CardNetworkUpdate):
    db: Session = SessionLocal()

    try:
        network = db.query(CardNetwork).filter(CardNetwork.id == network_id).first()
        if not network:
            raise HTTPException(status_code=404, detail="Card network not found")

        for field in get_payload_fields(payload):
            value = getattr(payload, field)
            if field == "name" and isinstance(value, str):
                value = value.strip() or None
            if field == "code" and isinstance(value, str):
                value = value.strip().upper() or None
            setattr(network, field, value)

        if not network.name or not network.code:
            raise HTTPException(status_code=400, detail="Network name and code are required")

        network.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(network)
        return serialize_network(network)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Card network already exists") from exc
    finally:
        db.close()


@router.delete("/{network_id}")
def delete_card_network(network_id: int):
    db: Session = SessionLocal()

    try:
        network = db.query(CardNetwork).filter(CardNetwork.id == network_id).first()
        if not network:
            raise HTTPException(status_code=404, detail="Card network not found")

        linked_cards = db.query(CreditCard).filter(CreditCard.network_id == network_id).count()
        if linked_cards:
            network.active = False
            network.updated_at = datetime.utcnow()
            db.commit()
            return {"deleted": False, "deactivated": True, "linked_cards": linked_cards}

        db.delete(network)
        db.commit()
        return {"deleted": True, "network_id": network_id}
    finally:
        db.close()
