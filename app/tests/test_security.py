"""Security regression tests: headers, body-size limit, CORS, error redaction."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import DatabaseStatus
from app.main import create_app
from app.security import install_security, redact_error_message


def _probe_ok() -> DatabaseStatus:
    return DatabaseStatus(connected=True, latency_ms=0.5, error=None)


def _client(settings: Settings | None = None):
    settings = settings or Settings(database_url="sqlite:///:memory:", cors_origins=())
    return TestClient(create_app(settings=settings, probe_db=_probe_ok))


def test_security_headers_present_on_every_response():
    response = _client().get("/api/health")
    assert response.status_code == 200

    expected = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Permitted-Cross-Domain-Policies": "none",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "no-store",
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
        "Server": "api",
    }
    for header, value in expected.items():
        assert response.headers.get(header) == value, f"missing/wrong {header}"


def test_security_headers_present_on_unknown_route():
    response = _client().get("/does-not-exist")
    assert response.status_code == 404
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"


def test_request_body_exceeding_limit_is_rejected_with_413():
    response = _client().post(
        "/api/health",
        headers={"Content-Length": str(10 * 1024 * 1024)},
        content=b"",
    )
    assert response.status_code == 413
    assert response.json() == {"detail": "Payload too large"}


def test_request_with_invalid_content_length_is_rejected_with_400():
    response = _client().post(
        "/api/health",
        headers={"Content-Length": "not-a-number"},
        content=b"",
    )
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid Content-Length"}


def test_cors_wildcard_with_credentials_is_rejected():
    settings = Settings(database_url="sqlite:///:memory:", cors_origins=("*",))
    with pytest.raises(ValueError, match="cannot include '\\*'"):
        create_app(settings=settings, probe_db=_probe_ok)


def test_cors_origin_without_scheme_is_rejected():
    settings = Settings(
        database_url="sqlite:///:memory:", cors_origins=("example.com",)
    )
    with pytest.raises(ValueError, match="must start with http"):
        create_app(settings=settings, probe_db=_probe_ok)


def test_cors_explicit_origins_are_honoured():
    settings = Settings(
        database_url="sqlite:///:memory:",
        cors_origins=("https://app.example.com",),
    )
    client = TestClient(create_app(settings=settings, probe_db=_probe_ok))
    response = client.get(
        "/api/health",
        headers={"Origin": "https://app.example.com"},
    )
    assert response.status_code == 200
    assert (
        response.headers.get("access-control-allow-origin")
        == "https://app.example.com"
    )


def test_unhandled_exception_returns_generic_500_without_traceback():
    def probe_boom() -> DatabaseStatus:
        raise RuntimeError("secret token=abc123 should not leak")

    settings = Settings(database_url="sqlite:///:memory:", cors_origins=())
    client = TestClient(
        create_app(settings=settings, probe_db=probe_boom),
        raise_server_exceptions=False,
    )
    response = client.get("/api/health")

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal Server Error"}
    # Ensure the exception message never appears in the response body or headers.
    blob = response.text + " ".join(f"{k}:{v}" for k, v in response.headers.items())
    assert "secret" not in blob.lower()
    assert "abc123" not in blob
    assert "Traceback" not in blob


@pytest.mark.parametrize(
    "message, expected_contains, expected_missing",
    [
        (
            "could not connect: postgresql://alice:s3cret@db.internal:5432/app",
            ["postgresql://[redacted]@db.internal:5432/app"],
            ["alice", "s3cret"],
        ),
        (
            "auth failed: password=hunter2 for user=alice",
            ["password=[redacted]"],
            ["hunter2"],
        ),
        (
            "token=sk-abcdef123 was rejected",
            ["token=[redacted]"],
            ["sk-abcdef123"],
        ),
        (
            "api_key: verylongsecret blew up",
            ["api_key: [redacted]"],
            ["verylongsecret"],
        ),
    ],
)
def test_redact_error_message_strips_credentials(
    message, expected_contains, expected_missing
):
    redacted = redact_error_message(message)
    assert redacted is not None
    for needle in expected_contains:
        assert needle in redacted, f"expected {needle!r} in {redacted!r}"
    for needle in expected_missing:
        assert needle not in redacted, f"unexpected {needle!r} in {redacted!r}"


def test_redact_error_message_truncates_overlong_input():
    message = "x" * 5000
    redacted = redact_error_message(message)
    assert redacted is not None
    assert len(redacted) <= 210  # 200 + ellipsis
    assert redacted.endswith("...")


def test_redact_error_message_passthrough_on_none():
    assert redact_error_message(None) is None


def test_install_security_is_idempotent_on_fresh_app():
    app = FastAPI()
    install_security(app)
    client = TestClient(app)
    response = client.get("/nothing")
    assert response.status_code == 404
    assert response.headers.get("X-Frame-Options") == "DENY"
