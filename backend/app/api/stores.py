import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.reward_program import RewardProgram
from app.models.spending_category import SpendingCategory
from app.models.store import Store
from app.services.credit_card_rewards import recalculate_rewards_for_store


router = APIRouter(prefix="/stores", tags=["stores"])
logger = logging.getLogger(__name__)


class StoreCreate(BaseModel):
    name: str
    store_type: str | None = None
    retailer_group: str | None = None
    merchant_category: str | None = None
    merchant_type: str | None = None
    spending_category_id: int | None = None
    reward_program_id: int | None = None
    active: bool = True
    earns_fuel_points: bool = False
    default_fuel_multiplier: int | None = None
    notes: str | None = None


class StoreUpdate(BaseModel):
    name: str | None = None
    store_type: str | None = None
    retailer_group: str | None = None
    merchant_category: str | None = None
    merchant_type: str | None = None
    spending_category_id: int | None = None
    reward_program_id: int | None = None
    active: bool | None = None
    earns_fuel_points: bool | None = None
    default_fuel_multiplier: int | None = None
    notes: str | None = None


def payload_fields(payload: BaseModel) -> set[str]:
    return set(
        getattr(
            payload,
            "model_fields_set",
            getattr(payload, "__fields_set__", set()),
        )
    )


def normalize_token(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower().replace(" ", "_").replace("-", "_")
    return normalized or None


def ensure_store_dependency_schema(db: Session) -> None:
    columns = {
        column["name"]
        for column in sa.inspect(db.bind).get_columns("spending_categories")
    }
    if "active" not in columns:
        db.execute(
            sa.text(
                "ALTER TABLE spending_categories "
                "ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE"
            )
        )


def validate_store_links(db: Session, payload: StoreCreate | StoreUpdate) -> None:
    if payload.spending_category_id is not None:
        category = (
            db.query(SpendingCategory)
            .filter(SpendingCategory.id == payload.spending_category_id)
            .first()
        )
        if not category:
            raise HTTPException(status_code=400, detail="Spending category not found")

    if payload.reward_program_id is not None:
        program = (
            db.query(RewardProgram)
            .filter(RewardProgram.id == payload.reward_program_id)
            .first()
        )
        if not program:
            raise HTTPException(status_code=400, detail="Reward program not found")


def serialize_store(db: Session, store: Store) -> dict:
    category = (
        db.query(SpendingCategory)
        .filter(SpendingCategory.id == store.spending_category_id)
        .first()
        if store.spending_category_id is not None
        else None
    )
    program = (
        db.query(RewardProgram)
        .filter(RewardProgram.id == store.reward_program_id)
        .first()
        if store.reward_program_id is not None
        else None
    )

    return {
        "id": store.id,
        "name": store.name,
        "store_type": store.store_type,
        "retailer_group": store.retailer_group,
        "merchant_category": store.merchant_category,
        "merchant_type": store.merchant_type,
        "spending_category_id": store.spending_category_id,
        "spending_category": (
            {"id": category.id, "key": category.key, "name": category.name}
            if category
            else None
        ),
        "reward_program_id": store.reward_program_id,
        "reward_program": (
            {
                "id": program.id,
                "name": program.name,
                "short_code": program.short_code,
                "category": program.category,
                "active": program.active,
            }
            if program
            else None
        ),
        "active": store.active,
        "earns_fuel_points": store.earns_fuel_points,
        "default_fuel_multiplier": store.default_fuel_multiplier,
        "notes": store.notes,
        "created_at": store.created_at,
    }


@router.post("/")
def create_store(payload: StoreCreate):
    db: Session = SessionLocal()

    try:
        ensure_store_dependency_schema(db)
        validate_store_links(db, payload)
        store = Store(
            name=payload.name.strip(),
            store_type=payload.store_type.strip() if payload.store_type else None,
            retailer_group=payload.retailer_group.strip() if payload.retailer_group else None,
            merchant_category=normalize_token(payload.merchant_category),
            merchant_type=normalize_token(payload.merchant_type),
            spending_category_id=payload.spending_category_id,
            reward_program_id=payload.reward_program_id,
            active=payload.active,
            earns_fuel_points=payload.earns_fuel_points,
            default_fuel_multiplier=payload.default_fuel_multiplier,
            notes=payload.notes,
        )

        db.add(store)
        db.commit()
        db.refresh(store)

        return serialize_store(db, store)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Store already exists") from exc

    finally:
        db.close()


@router.get("")
@router.get("/")
def list_stores():
    db: Session = SessionLocal()

    try:
        ensure_store_dependency_schema(db)
        db.commit()
        stores = db.query(Store).order_by(Store.name.asc()).all()
        return [serialize_store(db, store) for store in stores]
    except Exception:
        logger.exception("Failed to list stores")
        raise

    finally:
        db.close()


@router.patch("/{store_id}")
def update_store(store_id: int, payload: StoreUpdate):
    db: Session = SessionLocal()

    try:
        ensure_store_dependency_schema(db)
        store = db.query(Store).filter(Store.id == store_id).first()
        if not store:
            raise HTTPException(status_code=404, detail="Store not found")

        validate_store_links(db, payload)
        original_name = store.name

        for field in payload_fields(payload):
            value = getattr(payload, field)

            if field in {"merchant_category", "merchant_type"}:
                value = normalize_token(value)
            elif isinstance(value, str):
                value = value.strip() or None

            if field == "name" and not value:
                raise HTTPException(status_code=400, detail="Store name is required")

            setattr(store, field, value)

        db.flush()
        affected_purchase_count = recalculate_rewards_for_store(db, original_name)
        if store.name != original_name:
            affected_purchase_count += recalculate_rewards_for_store(db, store.name)
        db.commit()
        db.refresh(store)
        response = serialize_store(db, store)
        response["recalculated_purchase_count"] = affected_purchase_count
        return response
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Store already exists") from exc
    finally:
        db.close()
