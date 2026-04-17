# health-service

A tiny FastAPI service that exposes a single health endpoint backed by a real database probe.

## Endpoint

### `GET /api/health`

Reports process uptime, database reachability, and the current UTC time.

**200** — all dependencies healthy. **503** — a dependency is unavailable; the body still describes the failure.

Response shape:

| field             | type                        | notes                                                              |
| ----------------- | --------------------------- | ------------------------------------------------------------------ |
| `status`          | `"ok"` \| `"degraded"`      | `ok` when all dependencies respond, `degraded` otherwise.          |
| `uptime_seconds`  | `number`                    | Seconds since the FastAPI process started.                         |
| `database`        | object                      | See below.                                                         |
| `database.connected` | `boolean`                | `true` when a `SELECT 1` probe succeeded.                          |
| `database.latency_ms` | `number \| null`        | Round-trip time of the probe; `null` when the probe failed.        |
| `database.error`  | `string \| null`            | Error message from the failed probe; `null` on success. Credentials in driver errors are redacted before exposure. |
| `timestamp`       | `string` (ISO-8601, UTC)    | Server time at response generation, always in UTC.                 |

Example:

```json
{
  "status": "ok",
  "uptime_seconds": 42.187,
  "database": { "connected": true, "latency_ms": 1.42, "error": null },
  "timestamp": "2026-04-16T20:45:01.123456Z"
}
```

## Configuration

All config is read from environment variables — nothing is hardcoded.

| variable        | default                  | purpose                                                 |
| --------------- | ------------------------ | ------------------------------------------------------- |
| `DATABASE_URL`  | `sqlite:////data/app.db` | SQLAlchemy URL probed by the health endpoint.           |
| `CORS_ORIGINS`  | *(empty)*                | Comma-separated list of origins allowed to call the API. CORS middleware is only installed when at least one origin is set. Origins must include scheme; `*` is rejected because credentials are enabled. |

## Security posture

Every response carries conservative security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'`, HSTS, etc.). Requests with a `Content-Length` over 1 MiB are rejected with HTTP 413. Unhandled exceptions return a generic HTTP 500 — tracebacks and exception messages never reach the client.

## Running

```bash
pip install -e '.[dev]'
uvicorn app.main:app --reload
```

The service listens on `http://127.0.0.1:8000` by default. Hit `http://127.0.0.1:8000/api/health` to verify.

## Tests

```bash
pytest
```

The suite includes unit tests for each module plus a real-HTTP integration test that boots `uvicorn` on a random port and exercises the full ASGI → TCP → HTTP path. See `app/tests/TEST_REPORT.md` for the latest coverage breakdown.

## Troubleshooting

- **`503` with `database.connected: false`** — the configured `DATABASE_URL` is unreachable. The `error` field carries the (redacted) driver message; check the URL, network, and that the database accepts `SELECT 1`.
- **`ValueError: CORS_ORIGINS cannot include '*'`** at startup — the wildcard origin is refused because the service sets `allow_credentials=True`. List explicit origins instead (e.g. `CORS_ORIGINS=https://app.example.com,https://admin.example.com`).
- **`ValueError: CORS origin '...' must start with http://`** — every entry in `CORS_ORIGINS` must include the scheme.
- **HTTP `405` on a `POST` to `/api/health`** — only `GET` is registered; this is expected.
- **HTTP `413 Payload too large`** — `Content-Length` exceeds the 1 MiB cap. The endpoint expects empty-bodied `GET` requests.
- **Pytest fails to start with `ModuleNotFoundError` from a `callspec` plugin** — an unrelated third-party plugin in the environment is broken. Run `pytest -p no:callspec` to skip loading it; tests are unaffected.
