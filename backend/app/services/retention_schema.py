from sqlalchemy import text
from sqlalchemy.orm import Session


def ensure_retention_schema(db: Session) -> None:
    for statement in [
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50) DEFAULT 'receipt_image'",
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP",
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS retention_until TIMESTAMP",
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS retention_status VARCHAR(50) DEFAULT 'active'",
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS retain_attachment BOOLEAN DEFAULT false",
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS purged_at TIMESTAMP",
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS purge_metadata TEXT",
    ]:
        db.execute(text(statement))

    db.execute(
        text(
            "UPDATE receipts "
            "SET uploaded_at = COALESCE(uploaded_at, created_at), "
            "attachment_type = COALESCE(attachment_type, 'receipt_image'), "
            "retention_status = COALESCE(retention_status, 'active')"
        )
    )

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS attachment_retention_events (
                id INTEGER PRIMARY KEY,
                attachment_table VARCHAR(50) NOT NULL,
                attachment_id INTEGER NOT NULL,
                attachment_type VARCHAR(50),
                action VARCHAR(50) NOT NULL,
                file_path VARCHAR(500),
                reason TEXT,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
            )
            """
        )
    )
