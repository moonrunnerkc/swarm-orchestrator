# Test Report — health-service

**Date:** 2026-04-16
**Framework:** pytest 9.0.2 + pytest-cov 7.1.0
**Runtime:** Python 3.12.3
**Command:** `python3 -m pytest app/tests -p no:callspec --cov=app --cov-report=term-missing`

> Note on `-p no:callspec`: a broken third-party `callspec` plugin is installed system-wide in this environment and raises `ModuleNotFoundError` during pytest startup. Disabling it does **not** affect the tests themselves; it only skips loading that unrelated plugin. Not committed to `pyproject.toml` because it is environment-specific.

## Results

| Suite | File | Tests | Status |
|---|---|---:|---|
| Config loader | `app/tests/test_config.py` | 7 | PASS |
| Database probe | `app/tests/test_db.py` | 7 | PASS |
| /api/health (in-process) | `app/tests/test_health.py` | 7 | PASS |
| **Real HTTP integration** | `app/tests/test_integration_http.py` | **5** | **PASS** |
| App factory / CORS | `app/tests/test_main.py` | 7 | PASS |
| Pydantic schemas | `app/tests/test_schemas.py` | 11 | PASS |
| **Total** | | **44** | **PASS** |

All 44 tests pass in ~2.8 seconds.

## Coverage (application code — `app/`)

| Module | Statements | Missed | Coverage |
|---|---:|---:|---:|
| `app/__init__.py` | 0 | 0 | 100% |
| `app/config.py` | 11 | 0 | **100%** |
| `app/db.py` | 23 | 0 | **100%** |
| `app/main.py` | 19 | 0 | **100%** |
| `app/routes/__init__.py` | 0 | 0 | 100% |
| `app/routes/health.py` | 14 | 0 | **100%** |
| `app/schemas.py` | 12 | 0 | **100%** |
| **App total** | **79** | **0** | **100%** |

HTML report: `coverage_html/index.html`
JSON report: `coverage.json`

## What the tests verify

### Unit tests
- **Schemas** (`test_schemas.py`): Required/optional fields, literal-status constraint (`ok`/`degraded`), `uptime_seconds >= 0`, field-name contract (`status`, `uptime_seconds`, `database`, `timestamp` at top level; `connected`, `latency_ms`, `error` on database).
- **DB probe** (`test_db.py`): Success path against real in-memory SQLite (not mocked), failure path for a bad SQLite URL, latency formatting (rounded to 2dp), immutability of `DatabaseStatus`.
- **Config** (`test_config.py`): Default values, env override for `DATABASE_URL`, `CORS_ORIGINS` parsing (single, multiple, whitespace-stripped, empty-entry-filtered), `Settings` immutability.
- **App factory** (`test_main.py`): CORS middleware is absent when no origins configured, present and echoing allowed origin when configured, preflight rejects disallowed methods, default probe boots successfully against SQLite, unknown routes return 404.
- **Health route** (`test_health.py`, pre-existing): 200 happy path, 503 degraded path, uptime monotonicity, 405 on non-GET methods.

### Integration test (real HTTP)
`test_integration_http.py` boots a real `uvicorn` server on a random TCP port in a background thread, then uses `httpx` to make real network calls over localhost. This exercises the full ASGI → TCP → HTTP parser path (not an in-process `TestClient`). It verifies:
1. `GET /api/health` returns HTTP 200 with the exact schema the backend defines.
2. CORS preflight allows the configured origin.
3. Non-GET methods produce HTTP 405.
4. Unknown paths produce HTTP 404.
5. Response keys match the backend contract exactly (no extra fields, no renames).

## Field-name audit

Tests assert the exact field names returned by `app/routes/health.py`:

- Top level: `status`, `uptime_seconds`, `database`, `timestamp`
- `database` object: `connected`, `latency_ms`, `error`

Any rename on the backend will fail `test_integration_http.py::test_real_http_returns_only_contract_fields` and `test_schemas.py::test_top_level_field_names_match_backend_contract`.
