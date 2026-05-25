from sqlalchemy import text
from sqlalchemy.orm import Session


def ensure_attachment_schema(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS attachments (
                id SERIAL PRIMARY KEY,
                owner_type VARCHAR(50) NOT NULL,
                owner_id INTEGER NOT NULL,
                attachment_type VARCHAR(50) NOT NULL,
                storage_backend VARCHAR(20) NOT NULL,
                bucket VARCHAR(255),
                object_key VARCHAR(500) NOT NULL,
                original_filename VARCHAR(255),
                content_type VARCHAR(255),
                size_bytes INTEGER,
                checksum VARCHAR(128),
                uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                retention_until TIMESTAMP,
                purged_at TIMESTAMP
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_attachments_owner ON attachments (owner_type, owner_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_attachments_object_key ON attachments (object_key)"))
