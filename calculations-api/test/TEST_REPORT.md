# calculations-api Test Report

**Date**: 2026-04-16
**Runner**: Node.js built-in test runner (`node --test`)
**Coverage tool**: `--experimental-test-coverage`

## Summary

| Metric     | Value  |
|------------|--------|
| Total tests | 118   |
| Passing    | 118    |
| Failing    | 0      |
| Skipped    | 0      |
| Duration   | ~540ms |

## Coverage

| File                    | Line % | Branch % | Funcs % |
|-------------------------|--------|----------|---------|
| src/app.js              | 84.62  | 50.00    | 50.00   |
| src/config.js           | 100.00 | 100.00   | 100.00  |
| src/errors.js           | 100.00 | 100.00   | 100.00  |
| src/evaluate.js         | 90.91  | 93.42    | 100.00  |
| src/routes/calculations.js | 97.78 | 95.45  | 100.00  |
| src/routes/health.js    | 100.00 | 100.00   | 100.00  |
| src/store.js            | 91.30  | 90.32    | 90.00   |
| src/validation.js       | 100.00 | 100.00   | 100.00  |
| **All files**           | **94.86** | **94.98** | **94.55** |

## Test Files

| File | Tests | Focus |
|------|-------|-------|
| test/calculations.test.js | 27 | CRUD operations via supertest (POST/GET/PUT/DELETE) |
| test/config.test.js | 9 | Config loading, env vars, defaults, frozen object |
| test/evaluate.test.js | 18 | Expression parser: arithmetic, precedence, errors |
| test/health.test.js | 2 | Health endpoint response shape |
| test/store.test.js | 8 | JSON file store: CRUD, persistence, concurrency |
| test/validation.test.js | 24 | Request body validation, UUID validation, limits |
| test/errors.test.js | 12 | Error classes, notFoundHandler, errorHandler middleware |
| test/edge-cases.test.js | 18 | Field names, length limits, lifecycle, boundary inputs |
| test/integration-http.test.js | 7 | Real HTTP server: full CRUD, errors, CORS, security |

## Notes

- `app.js` uncovered lines are the `logRequests` middleware branch (not tested because logging is disabled in tests).
- `store.js` uncovered lines relate to the malformed-data-file error path and the `clear()` method.
- `evaluate.js` uncovered lines are edge cases in the tokenizer (malformed scientific notation, certain trailing-token paths).
- Integration tests (`integration-http.test.js`) start a real TCP server on an OS-assigned port and use `fetch()` for actual HTTP requests, verifying the full network stack.
