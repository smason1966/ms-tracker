from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card_brand import CardBrand
from app.services.card_brand_defaults import ensure_card_brand_defaults


router = APIRouter(prefix="/card-brands", tags=["card-brands"])


class CardBrandCreate(BaseModel):
    name: str
    active: bool = True
    supports_barcode: bool = True
    supports_magstripe: bool = False
    supports_ocr_template: bool = False
    parser_type: str | None = None
    parsing_profile: str | None = None
    notes: str | None = None
    magstripe_parser_type: str | None = None
    magstripe_parser_notes: str | None = None
    sample_magstripe_data: str | None = None
    card_number_regex: str | None = None
    pin_regex: str | None = None
    pin_label_keywords: str | None = None
    expected_pin_length: int | None = None
    card_number_source_priority: str | None = None
    pin_spatial_rule: str | None = None
    gift_code_regex: str | None = None
    gift_code_prefixes: str | None = None
    gift_code_expected_length: int | None = None
    gift_code_normalization: str | None = None
    ocr_confusion_map: str | None = None
    ocr_orientation_preference: str | None = "auto"
    credential_type: str | None = None
    ocr_zones: str | None = None


class CardBrandUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None
    supports_barcode: bool | None = None
    supports_magstripe: bool | None = None
    supports_ocr_template: bool | None = None
    parser_type: str | None = None
    parsing_profile: str | None = None
    notes: str | None = None
    magstripe_parser_type: str | None = None
    magstripe_parser_notes: str | None = None
    sample_magstripe_data: str | None = None
    card_number_regex: str | None = None
    pin_regex: str | None = None
    pin_label_keywords: str | None = None
    expected_pin_length: int | None = None
    card_number_source_priority: str | None = None
    pin_spatial_rule: str | None = None
    gift_code_regex: str | None = None
    gift_code_prefixes: str | None = None
    gift_code_expected_length: int | None = None
    gift_code_normalization: str | None = None
    ocr_confusion_map: str | None = None
    ocr_orientation_preference: str | None = None
    credential_type: str | None = None
    ocr_zones: str | None = None


class CardBrandOCRTemplateUpdate(BaseModel):
    ocr_orientation_preference: str | None = None
    credential_type: str | None = None
    ocr_zones: str | None = None


def get_card_brand_by_name(db: Session, brand_name: str) -> CardBrand | None:
    return (
        db.query(CardBrand)
        .filter(CardBrand.name.ilike(brand_name))
        .first()
    )


@router.post("/")
def create_card_brand(payload: CardBrandCreate):
    db: Session = SessionLocal()

    try:
        ensure_card_brand_defaults(db)
        normalized_name = payload.name.strip()
        if not normalized_name:
            raise HTTPException(status_code=422, detail="Card brand name is required")

        duplicate = (
            db.query(CardBrand)
            .filter(CardBrand.name.ilike(normalized_name))
            .first()
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "card_brand_duplicate",
                    "message": f"Card brand {normalized_name} already exists.",
                    "existing_brand_id": duplicate.id,
                    "existing_brand_status": "active" if duplicate.active else "inactive",
                },
            )

        card_brand = CardBrand(
            name=normalized_name,
            active=payload.active,
            supports_barcode=payload.supports_barcode,
            supports_magstripe=payload.supports_magstripe,
            supports_ocr_template=payload.supports_ocr_template,
            parser_type=payload.parser_type,
            parsing_profile=payload.parsing_profile,
            notes=payload.notes,
            magstripe_parser_type=payload.magstripe_parser_type,
            magstripe_parser_notes=payload.magstripe_parser_notes,
            sample_magstripe_data=payload.sample_magstripe_data,
            card_number_regex=payload.card_number_regex,
            pin_regex=payload.pin_regex,
            pin_label_keywords=payload.pin_label_keywords,
            expected_pin_length=payload.expected_pin_length,
            card_number_source_priority=payload.card_number_source_priority,
            pin_spatial_rule=payload.pin_spatial_rule,
            gift_code_regex=payload.gift_code_regex,
            gift_code_prefixes=payload.gift_code_prefixes,
            gift_code_expected_length=payload.gift_code_expected_length,
            gift_code_normalization=payload.gift_code_normalization,
            ocr_confusion_map=payload.ocr_confusion_map,
            ocr_orientation_preference=payload.ocr_orientation_preference,
            credential_type=payload.credential_type,
            ocr_zones=payload.ocr_zones,
        )

        db.add(card_brand)
        db.commit()
        db.refresh(card_brand)

        return card_brand

    finally:
        db.close()


@router.get("/")
def list_card_brands():
    db: Session = SessionLocal()

    try:
        ensure_card_brand_defaults(db)
        db.commit()
        return db.query(CardBrand).order_by(CardBrand.name.asc()).all()

    finally:
        db.close()


@router.get("/by-name/{brand_name}/ocr-template")
def get_card_brand_ocr_template(brand_name: str):
    db: Session = SessionLocal()

    try:
        ensure_card_brand_defaults(db)
        db.commit()
        card_brand = get_card_brand_by_name(db, brand_name)

        if not card_brand:
            raise HTTPException(status_code=404, detail="Card brand not found")

        return {
            "id": card_brand.id,
            "name": card_brand.name,
            "ocr_orientation_preference": card_brand.ocr_orientation_preference,
            "credential_type": card_brand.credential_type,
            "ocr_zones": card_brand.ocr_zones,
        }

    finally:
        db.close()


@router.patch("/{card_brand_id}")
def update_card_brand(card_brand_id: int, payload: CardBrandUpdate):
    db: Session = SessionLocal()

    try:
        ensure_card_brand_defaults(db)
        card_brand = (
            db.query(CardBrand)
            .filter(CardBrand.id == card_brand_id)
            .first()
        )

        if not card_brand:
            raise HTTPException(status_code=404, detail="Card brand not found")

        update_data = payload.model_dump(exclude_unset=True)
        if "name" in update_data and update_data["name"] is not None:
            normalized_name = update_data["name"].strip()
            if not normalized_name:
                raise HTTPException(status_code=422, detail="Card brand name is required")
            duplicate = (
                db.query(CardBrand)
                .filter(CardBrand.id != card_brand_id)
                .filter(CardBrand.name.ilike(normalized_name))
                .first()
            )
            if duplicate:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "card_brand_duplicate",
                        "message": f"Card brand {normalized_name} already exists.",
                        "existing_brand_id": duplicate.id,
                        "existing_brand_status": "active"
                        if duplicate.active
                        else "inactive",
                    },
                )
            update_data["name"] = normalized_name

        for field, value in update_data.items():
            setattr(card_brand, field, value)

        db.commit()
        db.refresh(card_brand)

        return card_brand

    finally:
        db.close()


@router.patch("/by-name/{brand_name}/ocr-template")
def update_card_brand_ocr_template(
    brand_name: str,
    payload: CardBrandOCRTemplateUpdate,
):
    db: Session = SessionLocal()

    try:
        ensure_card_brand_defaults(db)
        card_brand = get_card_brand_by_name(db, brand_name)

        if not card_brand:
            raise HTTPException(status_code=404, detail="Card brand not found")

        update_data = payload.model_dump(exclude_unset=True)

        for field, value in update_data.items():
            setattr(card_brand, field, value)

        db.commit()
        db.refresh(card_brand)

        return card_brand

    finally:
        db.close()
