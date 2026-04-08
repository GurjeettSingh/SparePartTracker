from __future__ import annotations

import os

from dotenv import load_dotenv


# Load .env for local development (safe no-op in Docker where env is provided)
load_dotenv()


def get_env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


DATABASE_URL = get_env(
    "DATABASE_URL",
    # Local dev default (non-docker)
    "postgresql+pg8000://spareparts:spareparts@localhost:5432/spareparts",
)

JWT_SECRET = get_env("JWT_SECRET", "dev-only-change-me")
JWT_ALGORITHM = get_env("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_DAYS = int(os.getenv("JWT_EXPIRES_DAYS", "7"))

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
