from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card_image import CardImage


router = APIRouter(prefix="/card-images", tags=["card-images"])

UPLOAD_DIR = Path("uploads/card-images")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload")
async def upload_card_image(
    gift_card_id: int = Form(...),
    file: UploadFile = File(...),
):
    extension = Path(file.filename).suffix
    filename = f"{uuid4()}{extension}"

    file_path = UPLOAD_DIR / filename

    contents = await file.read()

    with open(file_path, "wb") as f:
        f.write(contents)

    db: Session = SessionLocal()

    try:
        image = CardImage(
            gift_card_id=gift_card_id,
            image_type="primary",
            original_image_url=str(file_path),
        )

        db.add(image)
        db.commit()
        db.refresh(image)

        return image

    finally:
        db.close()