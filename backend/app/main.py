from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.card_brands import router as card_brands_router
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
from app.api.dashboard import router as dashboard_router
from app.api.purchase_payments import router as purchase_payments_router

app = FastAPI(title="MS Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://192.168.4.134:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(purchase_batches_router)
app.include_router(gift_cards_router)
app.include_router(stores_router)
app.include_router(card_brands_router)
app.include_router(buyers_router)
app.include_router(card_images_router)
app.include_router(card_image_queries_router)
app.include_router(extraction_attempts_router)
app.include_router(receipts_router)
app.include_router(extraction_candidates_router)
app.include_router(fuel_accounts_router)
app.include_router(fuel_point_entries_router)
app.include_router(credit_cards_router)
app.include_router(dashboard_router)
app.include_router(purchase_payments_router)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ms-tracker-api"}
