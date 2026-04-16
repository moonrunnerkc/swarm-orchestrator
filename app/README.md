# health-service

A tiny FastAPI service that exposes a single health endpoint.

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
| `database.error`  | `string \| null`            | Error message from the failed probe; `null` on success.            |
| `timestamp`       | `string` (ISO-8601, UTC)    | Server time at response generation, always in UTC.                 |

Example:

```json
{
  "status": "ok",
  "uptime_seconds": 42.187,
  "database": { "connected": true, "latency_ms": 1.42, "error": null },
  "timestamp": "2026-04-16T20:45:01.123456+00:00"
}
```

## Configuration

All config is read from environment variables — nothing is hardcoded.

| variable        | default                  | purpose                                                 |
| --------------- | ------------------------ | ------------------------------------------------------- |
| `DATABASE_URL`  | `sqlite:///./app.db`     | SQLAlchemy URL probed by the health endpoint.           |
| `CORS_ORIGINS`  | *(empty)*                | Comma-separated list of origins allowed to call the API. CORS middleware is only installed when at least one origin is set. |

## Running

```bash
pip install -e '.[dev]'
uvicorn app.main:app --reload
```

## Tests

```bash
pytest
```
