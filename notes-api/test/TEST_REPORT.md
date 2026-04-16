# Notes API Test Report

## Summary

| Metric        | Value  |
|---------------|--------|
| Total tests   | 145    |
| Passed        | 145    |
| Failed        | 0      |
| Skipped       | 0      |
| Suites        | 42     |

## Coverage

| File           | Line % | Branch % | Funcs % |
|----------------|--------|----------|---------|
| app.js         | 100.00 | 80.00    | 100.00  |
| config.js      | 100.00 | 100.00   | 100.00  |
| errors.js      | 100.00 | 100.00   | 100.00  |
| routes/health.js | 100.00 | 100.00 | 100.00  |
| routes/notes.js  | 100.00 | 100.00 | 100.00  |
| security.js    | 95.96  | 90.00    | 71.43   |
| store.js       | 100.00 | 100.00   | 95.24   |
| validation.js  | 100.00 | 100.00   | 100.00  |
| **All files**  | **99.33** | **98.31** | **94.23** |

Note: The uncovered lines in security.js (61-64) are the `setInterval` cleanup
callback inside the rate limiter, which runs on a timer and cannot be reliably
exercised without introducing flaky time-dependent tests.

## Test Files

### Unit Tests
- **config.test.js** — Configuration loading, env parsing, defaults, and validation
- **validation.test.js** — Request body validation for create/update and UUID validation
- **errors.test.js** — Error classes (ApiError, ValidationError, NotFoundError) and error handler middleware
- **store.test.js** — JSON file storage: CRUD, persistence, concurrent writes
- **store-advanced.test.js** — Store clear() persistence, auto-directory creation, error handling for missing dataFile
- **security.test.js** — Security headers and input sanitization
- **health.test.js** — Health check endpoint via supertest
- **app.test.js** — App factory: logRequests middleware, store.clear(), malformed data resilience, immutable field protection

### Integration Tests (supertest)
- **notes.test.js** — Full CRUD operations via supertest: POST, GET, PUT, DELETE with validation
- **edge-cases.test.js** — Response field names, boundary values, unicode, length limits, CRUD lifecycle
- **content-type.test.js** — Content-Type enforcement: 415 for non-JSON POST/PUT, passthrough for GET/DELETE
- **rate-limit.test.js** — Rate limiter: 429 response when limit exceeded, X-RateLimit headers, Retry-After

### Integration Tests (real HTTP)
- **integration-http.test.js** — Real HTTP server: health, full CRUD cycle, error shapes, CORS, security headers
- **integration-advanced.test.js** — Real HTTP server: concurrent creates, timestamp semantics, content-type handling, CORS preflight, comprehensive error responses
- **integration-full-http.test.js** — Raw http module (no supertest): full CRUD lifecycle, error responses, security headers, CORS, concurrent writes against a live server

## Edge Cases Covered
- Concurrent note creation (10 parallel requests via raw HTTP, no data loss)
- Rate limiting (429 response with correct headers when limit exceeded)
- Content-Type enforcement (415 for non-JSON mutation requests)
- Malformed data file (invalid JSON, missing items array)
- Unicode in title and content
- Boundary values (max title length 200, max content length 10000)
- Immutable field protection (id and createdAt cannot be overridden via PUT)
- Timestamp semantics (createdAt stays fixed, updatedAt advances on update)
- Empty body, missing fields, wrong types
- Invalid UUID formats in all endpoints (GET, PUT, DELETE)
- CORS preflight (OPTIONS) requests
- DELETE returns 204 with empty body
- Security headers present on all responses
- Auto-creation of data directory on first write
- Store clear() persists across instances
