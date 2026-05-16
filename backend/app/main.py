from fastapi import FastAPI

app = FastAPI(title="MS Tracker API")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ms-tracker-api"}