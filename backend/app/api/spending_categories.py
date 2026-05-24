from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.spending_category import SpendingCategory


router = APIRouter(prefix="/spending-categories", tags=["spending-categories"])


class SpendingCategoryCreate(BaseModel):
    key: str
    name: str
    notes: str | None = None


class SpendingCategoryUpdate(BaseModel):
    key: str | None = None
    name: str | None = None
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


@router.get("/")
def list_spending_categories():
    db: Session = SessionLocal()

    try:
        return db.query(SpendingCategory).order_by(SpendingCategory.name.asc()).all()
    finally:
        db.close()


@router.post("/")
def create_spending_category(payload: SpendingCategoryCreate):
    db: Session = SessionLocal()

    try:
        category = SpendingCategory(
            key=normalize_key(payload.key),
            name=payload.name.strip(),
            notes=payload.notes,
        )
        db.add(category)
        db.commit()
        db.refresh(category)
        return category
    finally:
        db.close()


@router.patch("/{category_id}")
def update_spending_category(
    category_id: int,
    payload: SpendingCategoryUpdate,
):
    db: Session = SessionLocal()

    try:
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
