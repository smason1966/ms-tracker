from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.attachment import Attachment
from app.services.storage import StoredObject


def record_attachment(
    db: Session,
    *,
    owner_type: str,
    owner_id: int,
    attachment_type: str,
    stored: StoredObject,
    retention_until: datetime | None = None,
) -> Attachment:
    attachment = Attachment(
        owner_type=owner_type,
        owner_id=owner_id,
        attachment_type=attachment_type,
        storage_backend=stored.storage_backend,
        bucket=stored.bucket,
        object_key=stored.object_key,
        original_filename=stored.original_filename,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        checksum=stored.checksum,
        retention_until=retention_until,
    )
    db.add(attachment)
    return attachment
