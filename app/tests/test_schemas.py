"""Unit tests for Pydantic response models (app.schemas) — field names, validation, defaults."""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas import DatabaseStatusPayload, HealthPayload


class TestDatabaseStatusPayload:
    def test_accepts_all_fields(self):
        payload = DatabaseStatusPayload(connected=True, latency_ms=4.2, error=None)

        assert payload.connected is True
        assert payload.latency_ms == 4.2
        assert payload.error is None

    def test_latency_and_error_default_to_none(self):
        payload = DatabaseStatusPayload(connected=False)

        assert payload.latency_ms is None
        assert payload.error is None

    def test_connected_is_required(self):
        with pytest.raises(ValidationError) as exc:
            DatabaseStatusPayload()

        assert "connected" in str(exc.value)

    def test_serialises_with_backend_field_names(self):
        payload = DatabaseStatusPayload(connected=False, latency_ms=None, error="boom")

        dumped = payload.model_dump()

        assert set(dumped.keys()) == {"connected", "latency_ms", "error"}
        assert dumped == {"connected": False, "latency_ms": None, "error": "boom"}


class TestHealthPayload:
    def _valid_database(self) -> DatabaseStatusPayload:
        return DatabaseStatusPayload(connected=True, latency_ms=1.0, error=None)

    def test_accepts_ok_status(self):
        payload = HealthPayload(
            status="ok",
            uptime_seconds=0.5,
            database=self._valid_database(),
            timestamp=datetime.now(timezone.utc),
        )

        assert payload.status == "ok"

    def test_accepts_degraded_status(self):
        payload = HealthPayload(
            status="degraded",
            uptime_seconds=10.0,
            database=DatabaseStatusPayload(connected=False, latency_ms=None, error="x"),
            timestamp=datetime.now(timezone.utc),
        )

        assert payload.status == "degraded"

    def test_rejects_unknown_status_literal(self):
        with pytest.raises(ValidationError):
            HealthPayload(
                status="healthy",
                uptime_seconds=0.0,
                database=self._valid_database(),
                timestamp=datetime.now(timezone.utc),
            )

    def test_rejects_negative_uptime(self):
        with pytest.raises(ValidationError) as exc:
            HealthPayload(
                status="ok",
                uptime_seconds=-0.1,
                database=self._valid_database(),
                timestamp=datetime.now(timezone.utc),
            )

        assert "uptime_seconds" in str(exc.value)

    def test_accepts_zero_uptime(self):
        payload = HealthPayload(
            status="ok",
            uptime_seconds=0.0,
            database=self._valid_database(),
            timestamp=datetime.now(timezone.utc),
        )

        assert payload.uptime_seconds == 0.0

    def test_top_level_field_names_match_backend_contract(self):
        payload = HealthPayload(
            status="ok",
            uptime_seconds=1.0,
            database=self._valid_database(),
            timestamp=datetime.now(timezone.utc),
        )

        dumped = payload.model_dump()

        assert set(dumped.keys()) == {"status", "uptime_seconds", "database", "timestamp"}

    def test_database_is_required(self):
        with pytest.raises(ValidationError):
            HealthPayload(
                status="ok",
                uptime_seconds=1.0,
                timestamp=datetime.now(timezone.utc),
            )
