"""End-to-end integration test: boots uvicorn on a real TCP port and hits /api/health over HTTP.

This complements the TestClient-based tests by exercising the real ASGI server,
the TCP socket, and the HTTP parser — catching regressions that in-process clients
would miss (bad serialization, middleware ordering, etc.).
"""

from __future__ import annotations

import socket
import threading
import time
from datetime import datetime

import httpx
import pytest
import uvicorn

from app.config import Settings
from app.db import DatabaseStatus
from app.main import create_app


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server(url: str, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            resp = httpx.get(url, timeout=1.0)
            if resp.status_code in (200, 503):
                return
        except httpx.HTTPError as exc:
            last_err = exc
        time.sleep(0.05)
    raise RuntimeError(f"server did not become ready at {url}: {last_err}")


class _UvicornThread:
    def __init__(self, app, host: str, port: int) -> None:
        self.config = uvicorn.Config(
            app,
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
            lifespan="off",
        )
        self.server = uvicorn.Server(self.config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=5.0)


@pytest.fixture(scope="module")
def live_server():
    settings = Settings(database_url="sqlite:///:memory:", cors_origins=("https://frontend.example",))

    def probe_ok() -> DatabaseStatus:
        return DatabaseStatus(connected=True, latency_ms=0.42, error=None)

    app = create_app(settings=settings, probe_db=probe_ok)

    port = _free_port()
    host = "127.0.0.1"
    base_url = f"http://{host}:{port}"

    server = _UvicornThread(app, host=host, port=port)
    server.start()
    try:
        _wait_for_server(f"{base_url}/api/health")
        yield base_url
    finally:
        server.stop()


def test_real_http_get_returns_200_and_matches_schema(live_server):
    response = httpx.get(f"{live_server}/api/health", timeout=5.0)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")

    body = response.json()

    assert body["status"] == "ok"
    assert isinstance(body["uptime_seconds"], (int, float))
    assert body["uptime_seconds"] >= 0

    db = body["database"]
    assert db == {"connected": True, "latency_ms": 0.42, "error": None}

    timestamp = datetime.fromisoformat(body["timestamp"])
    assert timestamp.tzinfo is not None


def test_real_http_cors_preflight_allows_configured_origin(live_server):
    response = httpx.options(
        f"{live_server}/api/health",
        headers={
            "Origin": "https://frontend.example",
            "Access-Control-Request-Method": "GET",
        },
        timeout=5.0,
    )

    assert response.headers.get("access-control-allow-origin") == "https://frontend.example"
    assert "GET" in response.headers.get("access-control-allow-methods", "").upper()


def test_real_http_rejects_non_get(live_server):
    response = httpx.post(f"{live_server}/api/health", timeout=5.0)

    assert response.status_code == 405


def test_real_http_unknown_path_returns_404(live_server):
    response = httpx.get(f"{live_server}/api/does-not-exist", timeout=5.0)

    assert response.status_code == 404


def test_real_http_returns_only_contract_fields(live_server):
    """Guard against accidental renames or extra fields leaking through the wire."""
    body = httpx.get(f"{live_server}/api/health", timeout=5.0).json()

    assert set(body.keys()) == {"status", "uptime_seconds", "database", "timestamp"}
    assert set(body["database"].keys()) == {"connected", "latency_ms", "error"}
