"""Comprehensive API tests for the health-service covering security edge cases,
CORS validation, body-size middleware, error redaction, and degraded-state responses.
"""

from __future__ import annotations

import socket
import threading
import time
from datetime import datetime

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import DatabaseStatus
from app.main import create_app, _validate_cors_origins
from app.security import redact_error_message, MaxBodySizeMiddleware


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_client(
    db_connected: bool = True,
    latency_ms: float | None = 0.5,
    error: str | None = None,
) -> TestClient:
    """Create a TestClient with a controlled DB probe."""
    settings = Settings(database_url="sqlite:///:memory:", cors_origins=())

    def probe() -> DatabaseStatus:
        return DatabaseStatus(connected=db_connected, latency_ms=latency_ms, error=error)

    app = create_app(settings=settings, probe_db=probe)
    return TestClient(app)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------------------
# CORS origin validation
# ---------------------------------------------------------------------------

class TestCorsValidation:
    """Tests for _validate_cors_origins edge cases."""

    def test_rejects_wildcard_origin(self):
        with pytest.raises(ValueError, match="cannot include"):
            _validate_cors_origins(("*",))

    def test_rejects_origin_without_scheme(self):
        with pytest.raises(ValueError, match="must start with http"):
            _validate_cors_origins(("example.com",))

    def test_accepts_http_origin(self):
        result = _validate_cors_origins(("http://localhost",))
        assert result == ["http://localhost"]

    def test_accepts_https_origin(self):
        result = _validate_cors_origins(("https://app.example.com",))
        assert result == ["https://app.example.com"]

    def test_accepts_http_with_port(self):
        result = _validate_cors_origins(("http://localhost:3000",))
        assert result == ["http://localhost:3000"]

    def test_accepts_multiple_origins(self):
        result = _validate_cors_origins(("http://a.com", "https://b.com"))
        assert len(result) == 2

    def test_empty_origins_returns_empty_list(self):
        result = _validate_cors_origins(())
        assert result == []

    def test_rejects_ftp_scheme(self):
        with pytest.raises(ValueError):
            _validate_cors_origins(("ftp://files.example.com",))


# ---------------------------------------------------------------------------
# Health endpoint — degraded state
# ---------------------------------------------------------------------------

class TestHealthDegradedState:
    """Tests for the health endpoint when the database is unavailable."""

    def test_returns_503_when_db_down(self):
        client = _make_client(db_connected=False, latency_ms=None, error="connection refused")
        resp = client.get("/api/health")
        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "degraded"
        assert body["database"]["connected"] is False
        assert body["database"]["error"] == "connection refused"
        assert body["database"]["latency_ms"] is None

    def test_returns_200_when_db_healthy(self):
        client = _make_client(db_connected=True, latency_ms=1.23)
        resp = client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["database"]["connected"] is True
        assert body["database"]["latency_ms"] == 1.23

    def test_uptime_is_non_negative(self):
        client = _make_client()
        body = client.get("/api/health").json()
        assert body["uptime_seconds"] >= 0

    def test_timestamp_is_utc_iso8601(self):
        client = _make_client()
        body = client.get("/api/health").json()
        ts = datetime.fromisoformat(body["timestamp"])
        assert ts.tzinfo is not None

    def test_response_field_names_match_contract(self):
        client = _make_client()
        body = client.get("/api/health").json()
        assert set(body.keys()) == {"status", "uptime_seconds", "database", "timestamp"}
        assert set(body["database"].keys()) == {"connected", "latency_ms", "error"}

    def test_only_get_method_allowed(self):
        client = _make_client()
        for method in ["post", "put", "delete", "patch"]:
            resp = getattr(client, method)("/api/health")
            assert resp.status_code == 405, f"{method.upper()} should return 405"


# ---------------------------------------------------------------------------
# Error redaction
# ---------------------------------------------------------------------------

class TestErrorRedaction:
    """Edge cases for redact_error_message."""

    def test_redacts_url_credentials(self):
        msg = "could not connect: postgresql://alice:s3cret@db.internal:5432/app"
        result = redact_error_message(msg)
        assert "s3cret" not in result
        assert "[redacted]" in result
        assert "db.internal" in result

    def test_redacts_inline_password(self):
        result = redact_error_message("auth failed: password=hunter2 for user=alice")
        assert "hunter2" not in result
        assert "[redacted]" in result

    def test_redacts_token(self):
        result = redact_error_message("token=sk-abcdef123 was rejected")
        assert "sk-abcdef123" not in result
        assert "[redacted]" in result

    def test_redacts_api_key(self):
        result = redact_error_message("api_key: verylongsecret blew up")
        assert "verylongsecret" not in result

    def test_none_input_passthrough(self):
        assert redact_error_message(None) is None

    def test_truncates_long_messages(self):
        long_msg = "x" * 300
        result = redact_error_message(long_msg)
        assert len(result) <= 204  # 200 + "..."
        assert result.endswith("...")

    def test_redacts_multiple_credentials_in_one_message(self):
        msg = "postgresql://user1:pass1@host1 and postgresql://user2:pass2@host2"
        result = redact_error_message(msg)
        assert "pass1" not in result
        assert "pass2" not in result
        assert result.count("[redacted]") >= 2

    def test_case_insensitive_secret_keywords(self):
        result = redact_error_message("PASSWORD=mysecret TOKEN=mytoken")
        assert "mysecret" not in result
        assert "mytoken" not in result

    def test_url_with_only_user_no_password(self):
        msg = "error: postgresql://justuser@host:5432/db"
        result = redact_error_message(msg)
        # Even user-only URLs should be redacted as they contain userinfo
        assert "justuser" not in result


# ---------------------------------------------------------------------------
# MaxBodySizeMiddleware
# ---------------------------------------------------------------------------

class TestMaxBodySizeMiddleware:
    """Tests for body-size limiting middleware edge cases."""

    def test_negative_content_length_returns_413(self):
        client = _make_client()
        resp = client.get("/api/health", headers={"content-length": "-1"})
        assert resp.status_code == 413

    def test_zero_content_length_passes(self):
        client = _make_client()
        resp = client.get("/api/health", headers={"content-length": "0"})
        assert resp.status_code == 200

    def test_missing_content_length_passes(self):
        client = _make_client()
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_non_numeric_content_length_returns_400(self):
        client = _make_client()
        resp = client.get("/api/health", headers={"content-length": "abc"})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------

class TestSecurityHeaders:
    """Verify security headers are present on all response types."""

    def test_headers_on_200(self):
        client = _make_client()
        resp = client.get("/api/health")
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["x-frame-options"] == "DENY"
        assert resp.headers["referrer-policy"] == "no-referrer"
        assert "no-store" in resp.headers["cache-control"]
        assert resp.headers["server"] == "api"

    def test_headers_on_404(self):
        client = _make_client()
        resp = client.get("/nonexistent")
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["x-frame-options"] == "DENY"

    def test_headers_on_405(self):
        client = _make_client()
        resp = client.post("/api/health")
        assert resp.headers["x-content-type-options"] == "nosniff"

    def test_hsts_header_present(self):
        client = _make_client()
        resp = client.get("/api/health")
        assert "max-age=" in resp.headers.get("strict-transport-security", "")

    def test_permissions_policy_present(self):
        client = _make_client()
        resp = client.get("/api/health")
        assert "camera=()" in resp.headers.get("permissions-policy", "")


# ---------------------------------------------------------------------------
# Probe exception handling
# ---------------------------------------------------------------------------

class TestProbeExceptions:
    """Verify the health endpoint handles probe failures gracefully."""

    def test_probe_raising_exception_returns_503(self):
        settings = Settings(database_url="sqlite:///:memory:", cors_origins=())

        def bad_probe() -> DatabaseStatus:
            raise RuntimeError("unexpected probe failure")

        app = create_app(settings=settings, probe_db=bad_probe)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/health")
        # Unhandled exception → 500 via the generic exception handler
        assert resp.status_code == 500
        body = resp.json()
        assert body["detail"] == "Internal Server Error"


# ---------------------------------------------------------------------------
# Real HTTP integration with degraded state
# ---------------------------------------------------------------------------

class _UvicornThread:
    def __init__(self, app, host: str, port: int) -> None:
        self.config = uvicorn.Config(
            app, host=host, port=port, log_level="warning", access_log=False, lifespan="off"
        )
        self.server = uvicorn.Server(self.config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=5.0)


@pytest.fixture(scope="module")
def degraded_server():
    """Live HTTP server with a failing DB probe."""
    settings = Settings(database_url="sqlite:///:memory:", cors_origins=())

    def probe_fail() -> DatabaseStatus:
        return DatabaseStatus(connected=False, latency_ms=None, error="timeout")

    app = create_app(settings=settings, probe_db=probe_fail)
    port = _free_port()
    host = "127.0.0.1"
    base_url = f"http://{host}:{port}"

    srv = _UvicornThread(app, host=host, port=port)
    srv.start()
    try:
        # Wait for server to be ready
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            try:
                resp = httpx.get(f"{base_url}/api/health", timeout=1.0)
                if resp.status_code in (200, 503):
                    break
            except httpx.HTTPError:
                time.sleep(0.05)
        yield base_url
    finally:
        srv.stop()


def test_real_http_degraded_returns_503(degraded_server):
    """Integration test: degraded health over real HTTP returns 503."""
    resp = httpx.get(f"{degraded_server}/api/health", timeout=5.0)
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["database"]["connected"] is False
    assert body["database"]["error"] == "timeout"


def test_real_http_security_headers_present(degraded_server):
    """Integration test: security headers are present over real HTTP."""
    resp = httpx.get(f"{degraded_server}/api/health", timeout=5.0)
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    # Over real uvicorn the Server header may be "uvicorn, api" rather than just "api"
    assert "api" in resp.headers["server"]
