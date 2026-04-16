"""Pydantic response models for the health endpoint."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DatabaseStatusPayload(BaseModel):
    connected: bool = Field(
        description="True when the database responded to a SELECT 1 probe.",
    )
    latency_ms: float | None = Field(
        default=None,
        description="Round-trip time for the probe in milliseconds; null when the probe failed.",
    )
    error: str | None = Field(
        default=None,
        description="Error message from the failed probe; null on success.",
    )


class HealthPayload(BaseModel):
    status: Literal["ok", "degraded"] = Field(
        description="'ok' when all dependencies are healthy, 'degraded' otherwise.",
    )
    uptime_seconds: float = Field(
        ge=0,
        description="Seconds since the FastAPI process started.",
    )
    database: DatabaseStatusPayload
    timestamp: datetime = Field(
        description="Current server time in UTC (ISO-8601).",
    )
