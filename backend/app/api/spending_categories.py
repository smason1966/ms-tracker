from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.credit_card_reward_rule import CreditCardRewardRule
from app.models.purchase_payment import PurchasePayment
from app.models.spending_category import SpendingCategory
from app.models.store import Store


router = APIRouter(prefix="/spending-categories", tags=["spending-categories"])


class SpendingCategoryCreate(BaseModel):
    key: str
    name: str
    notes: str | None = None


class SpendingCategoryUpdate(BaseModel):
    key: str | None = None
    name: str | None = None
    active: bool | None = None
    notes: str | None = None


def normalize_key(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


def payload_fields(payload: BaseModel) -> set[str]:
    return set(
        getattr(
            payload,
            "model_fields_set",
            getattr(payload, "__fields_set__", set()),
        )
    )


def ensure_spending_category_schema(db: Session) -> None:
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


@router.get("/")
def list_spending_categories():
    db: Session = SessionLocal()

    try:
        ensure_spending_category_schema(db)
        db.commit()
        return db.query(SpendingCategory).order_by(SpendingCategory.name.asc()).all()
    finally:
        db.close()


@router.post("/")
def create_spending_category(payload: SpendingCategoryCreate):
    db: Session = SessionLocal()

    try:
        ensure_spending_category_schema(db)
        category = SpendingCategory(
            key=normalize_key(payload.key),
            name=payload.name.strip(),
            active=True,
            notes=payload.notes,
        )
        db.add(category)
        db.commit()
        db.refresh(category)
        return category
    finally:
        db.close()


def category_reference_count(db: Session, category_id: int) -> int:
    return (
        db.query(Store).filter(Store.spending_category_id == category_id).count()
        + db.query(CreditCardRewardRule)
        .filter(CreditCardRewardRule.spending_category_id == category_id)
        .count()
        + db.query(PurchasePayment)
        .filter(PurchasePayment.spending_category_id == category_id)
        .count()
    )


@router.patch("/{category_id}")
def update_spending_category(
    category_id: int,
    payload: SpendingCategoryUpdate,
):
    db: Session = SessionLocal()

    try:
        ensure_spending_category_schema(db)
        category = (
            db.query(SpendingCategory)
            .filter(SpendingCategory.id == category_id)
            .first()
        )

        if not category:
            raise HTTPException(status_code=404, detail="Spending category not found")

        for field in payload_fields(payload):
            value = getattr(payload, field)

            if field == "key" and value is not None:
                value = normalize_key(value)

            setattr(category, field, value)

        db.commit()
        db.refresh(category)
        return category
    finally:
        db.close()


@router.delete("/{category_id}")
def delete_or_deactivate_spending_category(category_id: int):
    db: Session = SessionLocal()

    try:
        ensure_spending_category_schema(db)
        category = (
            db.query(SpendingCategory)
            .filter(SpendingCategory.id == category_id)
            .first()
        )

        if not category:
            raise HTTPException(status_code=404, detail="Spending category not found")

        reference_count = category_reference_count(db, category_id)
        if reference_count > 0:
            category.active = False
            inactive_note = (
                f"Marked inactive because {reference_count} existing record(s) reference it."
            )
            category.notes = (
                f"{category.notes.strip()}\n{inactive_note}"
                if category.notes and category.notes.strip()
                else inactive_note
            )
            db.commit()
            db.refresh(category)
            return {
                "deleted": False,
                "deactivated": True,
                "reference_count": reference_count,
                "category": category,
            }

        db.delete(category)
        db.commit()
        return {
            "deleted": True,
            "deactivated": False,
            "reference_count": 0,
        }
    finally:
        db.close()
