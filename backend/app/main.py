from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.card_brands import router as card_brands_router
from app.api.gift_cards import router as gift_cards_router
from app.api.purchase_batches import router as purchase_batches_router
from app.api.stores import router as stores_router

app = FastAPI(title="MS Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(purchase_batches_router)
app.include_router(gift_cards_router)
app.include_router(stores_router)
app.include_router(card_brands_router)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ms-tracker-api"}
