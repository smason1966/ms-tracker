from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.receipt import Receipt


router = APIRouter(prefix="/receipts", tags=["receipts"])

UPLOAD_DIR = Path("uploads/receipts")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload")
async def upload_receipt(
    purchase_batch_id: int = Form(...),
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
        receipt = Receipt(
            purchase_batch_id=purchase_batch_id,
            image_url=str(file_path),
            original_filename=file.filename,
        )

        db.add(receipt)
        db.commit()
        db.refresh(receipt)

        return receipt

    finally:
        db.close()


@router.get("/purchase/{purchase_batch_id}")
def list_receipts(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        return (
            db.query(Receipt)
            .filter(Receipt.purchase_batch_id == purchase_batch_id)
            .order_by(Receipt.created_at.desc())
            .all()
        )

    finally:
        db.close()