"""Unit tests for create_app — CORS wiring, default probe injection, and route registration."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.db import DatabaseStatus
from app.main import create_app


def _probe_ok() -> DatabaseStatus:
    return DatabaseStatus(connected=True, latency_ms=0.5, error=None)


def test_create_app_without_cors_origins_does_not_add_middleware():
    settings = Settings(database_url="sqlite:///:memory:", cors_origins=())

    client = TestClient(create_app(settings=settings, probe_db=_probe_ok))

    response = client.get(
        "/api/health",
        headers={"Origin": "https://not-allowed.example"},
    )

    assert response.status_code == 200
    assert "access-control-allow-origin" not in {k.lower() for k in response.headers}


def test_create_app_applies_cors_when_origins_configured():
    settings = Settings(
        database_url="sqlite:///:memory:",
        cors_origins=("https://allowed.example",),
    )

    client = TestClient(create_app(settings=settings, probe_db=_probe_ok))

    response = client.get(
        "/api/health",
        headers={"Origin": "https://allowed.example"},
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "https://allowed.example"


def test_create_app_cors_preflight_rejects_disallowed_method():
    settings = Settings(
        database_url="sqlite:///:memory:",
        cors_origins=("https://allowed.example",),
    )

    client = TestClient(create_app(settings=settings, probe_db=_probe_ok))

    response = client.options(
        "/api/health",
        headers={
            "Origin": "https://allowed.example",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert "access-control-allow-methods" in response.headers
    allowed = response.headers["access-control-allow-methods"]
    assert "POST" not in allowed.upper()
    assert "GET" in allowed.upper()


def test_create_app_uses_default_probe_against_sqlite_when_none_provided():
    settings = Settings(database_url="sqlite:///:memory:", cors_origins=())

    client = TestClient(create_app(settings=settings))

    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"]["connected"] is True


def test_create_app_uses_load_settings_when_none_provided(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("CORS_ORIGINS", "")

    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200


def test_unknown_route_returns_404():
    settings = Settings(database_url="sqlite:///:memory:", cors_origins=())

    client = TestClient(create_app(settings=settings, probe_db=_probe_ok))

    response = client.get("/api/nope")

    assert response.status_code == 404


def test_root_path_returns_404_when_no_root_route_registered():
    settings = Settings(database_url="sqlite:///:memory:", cors_origins=())

    client = TestClient(create_app(settings=settings, probe_db=_probe_ok))

    response = client.get("/")

    assert response.status_code == 404
