from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import check_db_connected

app = FastAPI(
    title="CodePulse API",
    description="Multi-tenant platform for automated DevOps provisioning and monitoring.",
    version="0.1.0"
)

# Setup CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    db_connected = check_db_connected()
    return {
        "status": "healthy",
        "db": "connected" if db_connected else "disconnected"
    }
