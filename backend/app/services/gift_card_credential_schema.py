from sqlalchemy import text
from sqlalchemy.orm import Session


def ensure_gift_card_credential_schema(db: Session) -> None:
    db.execute(
        text(
            "ALTER TABLE gift_cards "
            "ADD COLUMN IF NOT EXISTS card_source VARCHAR(50) DEFAULT 'physical'"
        )
    )
    db.execute(
        text(
            "ALTER TABLE gift_cards "
            "ADD COLUMN IF NOT EXISTS digital_source_notes TEXT"
        )
    )
    db.execute(
        text(
            "ALTER TABLE gift_cards "
            "ADD COLUMN IF NOT EXISTS confirmed_card_number TEXT"
        )
    )
    db.execute(
        text(
            "ALTER TABLE gift_cards "
            "ADD COLUMN IF NOT EXISTS confirmed_pin TEXT"
        )
    )
    db.execute(
        text(
            "ALTER TABLE gift_cards "
            "ADD COLUMN IF NOT EXISTS confirmed_redemption_code TEXT"
        )
    )
    db.execute(
        text(
            "ALTER TABLE gift_cards "
            "ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP"
        )
    )
    db.execute(
        text(
            "ALTER TABLE gift_cards "
            "ADD COLUMN IF NOT EXISTS confirmed_source VARCHAR(100)"
        )
    )
    db.execute(
        text(
            "UPDATE gift_cards "
            "SET confirmed_card_number = card_number_encrypted "
            "WHERE confirmed_card_number IS NULL "
            "AND card_number_encrypted IS NOT NULL "
            "AND trim(card_number_encrypted) != ''"
        )
    )
    db.execute(
        text(
            "UPDATE gift_cards "
            "SET confirmed_pin = pin_encrypted "
            "WHERE confirmed_pin IS NULL "
            "AND pin_encrypted IS NOT NULL "
            "AND trim(pin_encrypted) != ''"
        )
    )
    db.execute(
        text(
            "UPDATE gift_cards "
            "SET confirmed_at = verified_at "
            "WHERE confirmed_at IS NULL "
            "AND verified_at IS NOT NULL"
        )
    )
    db.execute(
        text(
            "UPDATE gift_cards "
            "SET confirmed_source = COALESCE(verification_source, 'legacy_verified') "
            "WHERE confirmed_source IS NULL "
            "AND (confirmed_card_number IS NOT NULL OR confirmed_pin IS NOT NULL)"
        )
    )
    db.execute(
        text(
            "UPDATE gift_cards "
            "SET card_source = 'physical' "
            "WHERE card_source IS NULL OR trim(card_source) = ''"
        )
    )
