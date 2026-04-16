"""FastAPI app factory wiring configuration, CORS, and the health router."""

import time
from typing import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, load_settings
from .db import DatabaseStatus, make_engine, ping_database
from .routes.health import build_health_router
from .security import install_security


def _validate_cors_origins(origins: tuple[str, ...]) -> list[str]:
    # Wildcard + credentials is a well-known CSRF footgun; refuse the combo
    # rather than silently letting the browser drop credentials.
    if "*" in origins:
        raise ValueError(
            "CORS_ORIGINS cannot include '*' when credentials are allowed. "
            "List explicit origins instead."
        )
    for origin in origins:
        if not (origin.startswith("https://") or origin.startswith("http://")):
            raise ValueError(
                f"CORS origin {origin!r} must start with http:// or https://"
            )
    return list(origins)


def create_app(
    settings: Settings | None = None,
    probe_db: Callable[[], DatabaseStatus] | None = None,
) -> FastAPI:
    resolved = settings or load_settings()

    if probe_db is None:
        engine = make_engine(resolved.database_url)
        probe_db = lambda: ping_database(engine)

    started_at = time.monotonic()

    app = FastAPI(title="health-service", version="0.1.0")

    install_security(app)

    if resolved.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=_validate_cors_origins(resolved.cors_origins),
            allow_credentials=True,
            allow_methods=["GET"],
            allow_headers=["*"],
        )

    app.include_router(
        build_health_router(
            probe_db=probe_db,
            uptime_seconds=lambda: time.monotonic() - started_at,
        )
    )

    return app


app = create_app()
