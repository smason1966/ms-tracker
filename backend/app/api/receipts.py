from pathlib import Path
from uuid import uuid4
from datetime import datetime, timedelta
from app.utils.time import utc_now

from fastapi import APIRouter, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.receipt import Receipt
from app.services.attachments import record_attachment
from app.services.retention_schema import ensure_retention_schema
from app.services.upload_storage import upload_dir
from app.services.storage import object_key_for, storage


router = APIRouter(prefix="/receipts", tags=["receipts"])

UPLOAD_DIR = upload_dir("receipts")
ATTACHMENT_RETENTION_DAYS = 365


@router.post("/upload")
async def upload_receipt(
    purchase_batch_id: int = Form(...),
    file: UploadFile = File(...),
):
    extension = Path(file.filename).suffix
    filename = f"{uuid4()}{extension}"
    object_key = object_key_for("receipts", filename)

    contents = await file.read()
    stored = storage.save(
        object_key=object_key,
        data=contents,
        original_filename=file.filename,
        content_type=file.content_type,
    )

    db: Session = SessionLocal()

    try:
        ensure_retention_schema(db)
        retention_until = utc_now() + timedelta(days=ATTACHMENT_RETENTION_DAYS)
        receipt = Receipt(
            purchase_batch_id=purchase_batch_id,
            image_url=storage.generate_view_url(stored.object_key),
            original_filename=file.filename,
            attachment_type="receipt_image",
            uploaded_at=utc_now(),
            retention_until=retention_until,
            retention_status="active",
        )

        db.add(receipt)
        db.flush()
        record_attachment(
            db,
            owner_type="receipt",
            owner_id=receipt.id,
            attachment_type="receipt_image",
            stored=stored,
            retention_until=retention_until,
        )
        db.commit()
        db.refresh(receipt)

        return receipt

    finally:
        db.close()


@router.get("/purchase/{purchase_batch_id}")
def list_receipts(purchase_batch_id: int):
    db: Session = SessionLocal()

    try:
        ensure_retention_schema(db)
        db.commit()
        return (
            db.query(Receipt)
            .filter(Receipt.purchase_batch_id == purchase_batch_id)
            .order_by(Receipt.created_at.desc())
            .all()
        )

    finally:
        db.close()
