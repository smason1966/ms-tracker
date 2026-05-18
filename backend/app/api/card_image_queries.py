from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card_image import CardImage


router = APIRouter(prefix="/card-images", tags=["card-images"])


@router.get("/gift-card/{gift_card_id}")
def list_card_images(gift_card_id: int):
    db: Session = SessionLocal()

    try:
        return (
            db.query(CardImage)
            .filter(CardImage.gift_card_id == gift_card_id)
            .order_by(CardImage.created_at.desc())
            .all()
        )

    finally:
        db.close()