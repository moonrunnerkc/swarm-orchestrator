"""Database connectivity probe used by the health endpoint."""

import time
from dataclasses import dataclass

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from .security import redact_error_message


@dataclass(frozen=True)
class DatabaseStatus:
    connected: bool
    latency_ms: float | None
    error: str | None


def make_engine(database_url: str) -> Engine:
    # hide_parameters prevents SQLAlchemy from embedding bind parameters in
    # exception messages, which can carry caller-supplied secrets into logs.
    return create_engine(
        database_url,
        pool_pre_ping=False,
        future=True,
        hide_parameters=True,
    )


def ping_database(engine: Engine) -> DatabaseStatus:
    start = time.perf_counter()
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        cause = exc.__cause__ or exc
        message = str(cause).strip() or exc.__class__.__name__
        return DatabaseStatus(
            connected=False,
            latency_ms=None,
            error=redact_error_message(message),
        )

    elapsed_ms = (time.perf_counter() - start) * 1000
    return DatabaseStatus(
        connected=True,
        latency_ms=round(elapsed_ms, 2),
        error=None,
    )
