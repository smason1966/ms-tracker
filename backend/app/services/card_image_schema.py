from sqlalchemy import text
from sqlalchemy.orm import Session


def ensure_card_image_schema(db: Session) -> None:
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS canonical_rotation_degrees INTEGER"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS orientation_source VARCHAR(50)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS canonical_transform_metadata TEXT"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50) DEFAULT 'card_image'"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS retention_until TIMESTAMP"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS retention_status VARCHAR(50) DEFAULT 'active'"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS retain_attachment BOOLEAN DEFAULT false"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS purged_at TIMESTAMP"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_images "
            "ADD COLUMN IF NOT EXISTS purge_metadata TEXT"
        )
    )
    db.execute(
        text(
            "UPDATE card_images "
            "SET uploaded_at = COALESCE(uploaded_at, created_at), "
            "attachment_type = COALESCE(attachment_type, 'card_image'), "
            "retention_status = COALESCE(retention_status, 'active')"
        )
    )
