from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.purchase_batches import router as purchase_batches_router
from app.api.gift_cards import router as gift_cards_router

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

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ms-tracker-api"}