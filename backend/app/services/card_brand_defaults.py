from sqlalchemy import text
from sqlalchemy.orm import Session


DEFAULT_CARD_BRAND_CAPABILITIES = {
    "best buy": {
        "supports_barcode": True,
        "supports_ocr_template": True,
        "parser_type": "barcode_ocr",
        "parsing_profile": "best_buy",
    },
    "nike": {
        "supports_barcode": True,
        "supports_ocr_template": True,
        "parser_type": "barcode_ocr",
        "parsing_profile": "nike",
    },
    "doordash": {
        "supports_barcode": False,
        "supports_ocr_template": True,
        "parser_type": "ocr_redemption_code",
        "parsing_profile": "doordash",
    },
    "uber": {
        "supports_barcode": True,
        "supports_ocr_template": True,
        "parser_type": "ocr_redemption_code",
        "parsing_profile": "uber",
    },
    "home depot": {
        "supports_barcode": True,
        "supports_ocr_template": False,
        "parser_type": "manual",
        "parsing_profile": "home_depot",
    },
}


def ensure_card_brand_schema(db: Session) -> None:
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS supports_barcode BOOLEAN NOT NULL DEFAULT FALSE"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS supports_magstripe BOOLEAN NOT NULL DEFAULT FALSE"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS supports_ocr_template BOOLEAN NOT NULL DEFAULT FALSE"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS parser_type VARCHAR(80)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS parsing_profile VARCHAR(80)"
        )
    )
    db.execute(
        text("ALTER TABLE card_brands ADD COLUMN IF NOT EXISTS notes TEXT")
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS magstripe_parser_type VARCHAR(80)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS magstripe_parser_notes TEXT"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS sample_magstripe_data TEXT"
        )
    )
    db.execute(
        text("ALTER TABLE card_brands ADD COLUMN IF NOT EXISTS card_number_regex TEXT")
    )
    db.execute(
        text("ALTER TABLE card_brands ADD COLUMN IF NOT EXISTS pin_regex TEXT")
    )
    db.execute(
        text("ALTER TABLE card_brands ADD COLUMN IF NOT EXISTS pin_label_keywords TEXT")
    )
    db.execute(
        text("ALTER TABLE card_brands ADD COLUMN IF NOT EXISTS expected_pin_length INTEGER")
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS card_number_source_priority VARCHAR(120)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS pin_spatial_rule VARCHAR(120)"
        )
    )
    db.execute(
        text("ALTER TABLE card_brands ADD COLUMN IF NOT EXISTS gift_code_regex TEXT")
    )
    db.execute(
        text("ALTER TABLE card_brands ADD COLUMN IF NOT EXISTS gift_code_prefixes TEXT")
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS gift_code_expected_length INTEGER"
        )
    )
    db.execute(
        text(
            "ALTER TABLE card_brands "
            "ADD COLUMN IF NOT EXISTS gift_code_normalization VARCHAR(120)"
        )
    )
    db.execute(
        text("ALTER TABLE card_brands ADD COLUMN IF NOT EXISTS ocr_confusion_map TEXT")
    )


def ensure_card_brand_defaults(db: Session) -> None:
    ensure_card_brand_schema(db)

    for name, values in DEFAULT_CARD_BRAND_CAPABILITIES.items():
        db.execute(
            text(
                """
                UPDATE card_brands
                SET
                    supports_barcode = :supports_barcode,
                    supports_ocr_template = :supports_ocr_template,
                    parser_type = COALESCE(parser_type, :parser_type),
                    parsing_profile = COALESCE(parsing_profile, :parsing_profile)
                WHERE lower(name) = :name
                """
            ),
            {"name": name, **values},
        )
