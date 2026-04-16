"""/api/health route — reports uptime, DB status, and UTC timestamp."""

from datetime import datetime, timezone
from typing import Callable

from fastapi import APIRouter, Response, status

from ..db import DatabaseStatus
from ..schemas import DatabaseStatusPayload, HealthPayload


def build_health_router(
    probe_db: Callable[[], DatabaseStatus],
    uptime_seconds: Callable[[], float],
) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["health"])

    @router.get(
        "/health",
        response_model=HealthPayload,
        responses={
            200: {"description": "All dependencies healthy."},
            503: {
                "model": HealthPayload,
                "description": "At least one dependency is unavailable; body details which.",
            },
        },
    )
    def get_health(response: Response) -> HealthPayload:
        db = probe_db()

        if not db.connected:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

        return HealthPayload(
            status="ok" if db.connected else "degraded",
            uptime_seconds=round(uptime_seconds(), 3),
            database=DatabaseStatusPayload(
                connected=db.connected,
                latency_ms=db.latency_ms,
                error=db.error,
            ),
            timestamp=datetime.now(timezone.utc),
        )

    return router
