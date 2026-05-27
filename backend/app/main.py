import os
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.card_brands import router as card_brands_router
from app.api.card_issuers import router as card_issuers_router
from app.api.card_networks import router as card_networks_router
from app.api.buyers import router as buyers_router
from app.api.gift_cards import router as gift_cards_router
from app.api.purchase_batches import router as purchase_batches_router
from app.api.stores import router as stores_router
from app.api.card_images import router as card_images_router
from fastapi.staticfiles import StaticFiles
from app.api.card_image_queries import router as card_image_queries_router
from app.api.extraction_attempts import router as extraction_attempts_router
from app.api.extraction_candidates import router as extraction_candidates_router
from app.api.receipts import router as receipts_router
from app.api.fuel_accounts import router as fuel_accounts_router
from app.api.fuel_point_entries import router as fuel_point_entries_router
from app.api.credit_cards import router as credit_cards_router
from app.api.spending_categories import router as spending_categories_router
from app.api.dashboard import router as dashboard_router
from app.api.purchase_payments import router as purchase_payments_router
from app.api.sales import router as sales_router
from app.api.payment_accounts import router as payment_accounts_router
from app.api.players import router as players_router
from app.api.reward_program_categories import router as reward_program_categories_router
from app.api.reward_programs import router as reward_programs_router
from app.api.data_transfer import router as data_transfer_router
from app.api.retention import router as retention_router
from app.db.session import SessionLocal
from app.services.attachment_schema import ensure_attachment_schema
from app.services.card_brand_defaults import ensure_card_brand_defaults
from app.services.card_image_schema import ensure_card_image_schema
from app.services.gift_card_credential_schema import ensure_gift_card_credential_schema
from app.services.field_encryption import validate_field_encryption_configuration
from app.services.ocr_debug import cleanup_ocr_debug_files
from app.services.retention_schema import ensure_retention_schema
from app.services.reward_program_categories import load_reward_program_categories
from app.services.reward_program_defaults import ensure_default_reward_program_values
from app.services.upload_storage import (
    UPLOAD_ROOT,
    ensure_upload_directories,
    warn_if_uploads_empty_but_db_references,
)

ensure_upload_directories()
app = FastAPI(title="MS Tracker API")

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.4.134:3000",
]


def cors_origins() -> list[str]:
    configured_origins = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]
    return list(dict.fromkeys([*DEFAULT_CORS_ORIGINS, *configured_origins]))


app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(purchase_batches_router)
app.include_router(gift_cards_router)
app.include_router(stores_router)
app.include_router(card_brands_router)
app.include_router(card_issuers_router)
app.include_router(card_networks_router)
app.include_router(buyers_router)
app.include_router(card_images_router)
app.include_router(card_image_queries_router)
app.include_router(extraction_attempts_router)
app.include_router(receipts_router)
app.include_router(extraction_candidates_router)
app.include_router(fuel_accounts_router)
app.include_router(fuel_point_entries_router)
app.include_router(credit_cards_router)
app.include_router(spending_categories_router)
app.include_router(dashboard_router)
app.include_router(purchase_payments_router)
app.include_router(sales_router)
app.include_router(payment_accounts_router)
app.include_router(players_router)
app.include_router(reward_program_categories_router)
app.include_router(reward_programs_router)
app.include_router(data_transfer_router)
app.include_router(retention_router)

app.mount("/uploads", StaticFiles(directory=UPLOAD_ROOT), name="uploads")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ms-tracker-api"}


@app.on_event("startup")
def ensure_reward_program_defaults():
    validate_field_encryption_configuration()
    ensure_upload_directories()
    threading.Thread(
        target=cleanup_ocr_debug_files,
        name="ocr-debug-cleanup",
        daemon=True,
    ).start()

    db = SessionLocal()

    try:
        ensure_card_brand_defaults(db)
        ensure_card_image_schema(db)
        ensure_attachment_schema(db)
        ensure_gift_card_credential_schema(db)
        ensure_retention_schema(db)
        load_reward_program_categories(db)
        ensure_default_reward_program_values(db)
        warn_if_uploads_empty_but_db_references(db)
        db.commit()
    finally:
        db.close()
