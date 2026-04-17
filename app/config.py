"""Environment-driven configuration for the health service."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    cors_origins: tuple[str, ...]


def load_settings() -> Settings:
    database_url = os.getenv("DATABASE_URL", "sqlite:////data/app.db")

    raw_origins = os.getenv("CORS_ORIGINS", "")
    origins = tuple(o.strip() for o in raw_origins.split(",") if o.strip())

    return Settings(database_url=database_url, cors_origins=origins)
