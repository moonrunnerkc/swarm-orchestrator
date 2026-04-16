"""Tests for /api/health covering the happy path and DB-unavailable error case."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import DatabaseStatus
from app.main import create_app


def _make_client(probe_db):
    settings = Settings(database_url="sqlite:///:memory:", cors_origins=())
    app = create_app(settings=settings, probe_db=probe_db)
    return TestClient(app)


def test_health_returns_200_and_expected_payload_when_database_is_reachable():
    def probe_ok() -> DatabaseStatus:
        return DatabaseStatus(connected=True, latency_ms=1.23, error=None)

    client = _make_client(probe_ok)

    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()

    assert body["status"] == "ok"
    assert body["database"] == {"connected": True, "latency_ms": 1.23, "error": None}
    assert body["uptime_seconds"] >= 0

    parsed = datetime.fromisoformat(body["timestamp"])
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() == timezone.utc.utcoffset(parsed)


def test_health_returns_503_and_degraded_status_when_database_probe_fails():
    probe_error = "could not connect to server: Connection refused"

    def probe_down() -> DatabaseStatus:
        return DatabaseStatus(connected=False, latency_ms=None, error=probe_error)

    client = _make_client(probe_down)

    response = client.get("/api/health")

    assert response.status_code == 503
    body = response.json()

    assert body["status"] == "degraded"
    assert body["database"]["connected"] is False
    assert body["database"]["latency_ms"] is None
    assert body["database"]["error"] == probe_error
    assert "timestamp" in body


def test_health_uptime_increases_between_calls():
    def probe_ok() -> DatabaseStatus:
        return DatabaseStatus(connected=True, latency_ms=0.5, error=None)

    client = _make_client(probe_ok)

    first = client.get("/api/health").json()["uptime_seconds"]
    second = client.get("/api/health").json()["uptime_seconds"]

    assert second >= first


@pytest.mark.parametrize("method", ["post", "put", "delete", "patch"])
def test_health_rejects_non_get_methods(method):
    def probe_ok() -> DatabaseStatus:
        return DatabaseStatus(connected=True, latency_ms=0.5, error=None)

    client = _make_client(probe_ok)
    response = getattr(client, method)("/api/health")

    assert response.status_code == 405
