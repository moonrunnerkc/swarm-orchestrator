# Notes API Test Report

## Summary

| Metric        | Value  |
|---------------|--------|
| Total tests   | 123    |
| Passed        | 123    |
| Failed        | 0      |
| Skipped       | 0      |
| Suites        | 37     |

## Coverage

| File           | Line % | Branch % | Funcs % |
|----------------|--------|----------|---------|
| app.js         | 100.00 | 80.00    | 100.00  |
| config.js      | 100.00 | 100.00   | 100.00  |
| errors.js      | 100.00 | 100.00   | 100.00  |
| routes/health.js | 100.00 | 100.00 | 100.00  |
| routes/notes.js  | 100.00 | 100.00 | 100.00  |
| security.js    | 100.00 | 100.00   | 100.00  |
| store.js       | 100.00 | 97.22    | 95.24   |
| validation.js  | 100.00 | 100.00   | 100.00  |
| **All files**  | **100.00** | **98.77** | **97.87** |

## Test Files

### Unit Tests
- **config.test.js** — Configuration loading, env parsing, defaults, and validation
- **validation.test.js** — Request body validation for create/update and UUID validation
- **errors.test.js** — Error classes (ApiError, ValidationError, NotFoundError) and error handler middleware
- **store.test.js** — JSON file storage: CRUD, persistence, concurrent writes
- **security.test.js** — Security headers and input sanitization
- **health.test.js** — Health check endpoint via supertest
- **app.test.js** — App factory: logRequests middleware, store.clear(), malformed data resilience, immutable field protection

### Integration Tests (supertest)
- **notes.test.js** — Full CRUD operations via supertest: POST, GET, PUT, DELETE with validation
- **edge-cases.test.js** — Response field names, boundary values, unicode, length limits, CRUD lifecycle

### Integration Tests (real HTTP)
- **integration-http.test.js** — Real HTTP server: health, full CRUD cycle, error shapes, CORS, security headers
- **integration-advanced.test.js** — Real HTTP server: concurrent creates, timestamp semantics, content-type handling, CORS preflight, comprehensive error responses

## Edge Cases Covered
- Concurrent note creation (5 parallel requests, no data loss)
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
