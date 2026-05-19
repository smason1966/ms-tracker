from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.store import Store


router = APIRouter(prefix="/stores", tags=["stores"])


class StoreCreate(BaseModel):
    name: str
    store_type: str | None = None
    active: bool = True
    earns_fuel_points: bool = False
    default_fuel_multiplier: int | None = None


@router.post("/")
def create_store(payload: StoreCreate):
    db: Session = SessionLocal()

    try:
        store = Store(
            name=payload.name,
            store_type=payload.store_type,
            active=payload.active,
            earns_fuel_points=payload.earns_fuel_points,
            default_fuel_multiplier=payload.default_fuel_multiplier,
        )

        db.add(store)
        db.commit()
        db.refresh(store)

        return store

    finally:
        db.close()


@router.get("/")
def list_stores():
    db: Session = SessionLocal()

    try:
        return db.query(Store).order_by(Store.name.asc()).all()

    finally:
        db.close()
