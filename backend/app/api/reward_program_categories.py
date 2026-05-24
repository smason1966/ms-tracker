from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.services.reward_program_categories import (
    load_reward_program_categories,
    normalize_category_name,
    save_reward_program_categories,
)


router = APIRouter(
    prefix="/reward-program-categories",
    tags=["reward-program-categories"],
)


class RewardProgramCategoryCreate(BaseModel):
    name: str
    active: bool = True
    notes: str | None = None


class RewardProgramCategoryUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None
    notes: str | None = None


@router.get("/")
def list_reward_program_categories():
    db: Session = SessionLocal()

    try:
        categories = load_reward_program_categories(db)
        db.commit()
        return categories
    finally:
        db.close()


@router.post("/")
def create_reward_program_category(payload: RewardProgramCategoryCreate):
    db: Session = SessionLocal()

    try:
        categories = load_reward_program_categories(db)
        name = normalize_category_name(payload.name)
        if not name:
            raise HTTPException(status_code=400, detail="Category name is required")
        if any(category["name"].lower() == name.lower() for category in categories):
            raise HTTPException(status_code=409, detail="Category already exists")

        categories.append(
            {
                "name": name,
                "active": payload.active,
                "notes": payload.notes or "",
            }
        )
        saved = save_reward_program_categories(db, categories)
        db.commit()
        return saved
    except HTTPException:
        db.rollback()
        raise
    finally:
        db.close()


@router.patch("/{category_name}")
def update_reward_program_category(
    category_name: str,
    payload: RewardProgramCategoryUpdate,
):
    db: Session = SessionLocal()

    try:
        categories = load_reward_program_categories(db)
        current_name = normalize_category_name(category_name)
        index = next(
            (
                idx
                for idx, category in enumerate(categories)
                if category["name"].lower() == current_name.lower()
            ),
            None,
        )
        if index is None:
            raise HTTPException(status_code=404, detail="Category not found")

        updated = dict(categories[index])
        if payload.name is not None:
            new_name = normalize_category_name(payload.name)
            if not new_name:
                raise HTTPException(status_code=400, detail="Category name is required")
            if any(
                idx != index and category["name"].lower() == new_name.lower()
                for idx, category in enumerate(categories)
            ):
                raise HTTPException(status_code=409, detail="Category already exists")
            updated["name"] = new_name
        if payload.active is not None:
            updated["active"] = payload.active
        if payload.notes is not None:
            updated["notes"] = payload.notes

        categories[index] = updated
        saved = save_reward_program_categories(db, categories)
        db.commit()
        return saved
    except HTTPException:
        db.rollback()
        raise
    finally:
        db.close()
