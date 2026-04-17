# API Test Coverage Report

Generated: 2026-04-17

## Summary

| Service | Tests | Pass | Fail | Line % | Branch % | Funcs % |
|---------|-------|------|------|--------|----------|---------|
| calculations-api | 158 | 158 | 0 | 97.01% | 94.31% | 95.71% |
| notes-api | 160 | 160 | 0 | 98.53% | 96.50% | 94.64% |
| health-service (Python) | 59 | 59 | 0 | 99% | N/A | N/A |
| web (Inkwell) | 64 | 64 | 0 | N/A | N/A | N/A |
| **Total** | **441** | **441** | **0** | | | |

## Coverage Improvements

### calculations-api (93.58% -> 97.01% line, 89.41% -> 94.31% branch)

New tests added in `test/coverage-gaps.test.js`:
- Store edge cases: malformed data file, invalid JSON, clear(), missing ID update/remove
- Evaluate edge cases: non-finite result (Infinity), malformed scientific notation, trailing tokens, unexpected tokens, unary operators, nested parentheses
- sanitiseForReflection: truncation, type coercion, control character stripping
- App with logRequests enabled (previously uncovered branch)
- Pagination: limit, offset, limit+offset, offset beyond total
- Sorting: by result, createdAt, invalid field fallback
- Stats: empty stats, negative results

New tests added in `test/cross-service-integration.test.js`:
- Both services health check simultaneously
- Field name verification (expression/result/title for calcs, title/content for notes)
- Concurrent creates across both services
- List response shape validation
- Security headers on both services
- JSON content-type enforcement on both services
- 404 for non-existent resources on both services
- Full update and delete cycle on both services

### notes-api (97.05% -> 98.53% line, 93.43% -> 96.50% branch)

New tests added in `test/coverage-gaps.test.js`:
- Search filtering: by title, by content, case-insensitive, no matches, whitespace-only query
- Pagination: limit, offset, limit+offset, offset beyond total
- Sorting: by title ascending, by createdAt ascending, invalid field fallback
- Combined search with pagination
- App with logRequests enabled
- CRUD with logging enabled

### health-service (Python) - 99% (unchanged, already comprehensive)

### web (Inkwell) - 64 tests passing (unchanged)

## Remaining Uncovered Lines

### calculations-api
- `evaluate.js:62-66, 162` - Malformed number literal (Number() returning non-finite for parsed token), unknown operator default case
- `calculations.js:58-59, 77, 91-92` - Error catch in stats route, sort equality comparator return, error catch in list route
- `security.js:78-81, 100-107` - Rate limiter setInterval cleanup callback, rate limit exceeded response (requires timing-dependent test)
- `validation.js:16-20` - Prototype pollution key rejection

### notes-api
- `notes.js:55` - Sort equality comparator return (values equal)
- `security.js:63-66` - Rate limiter cleanup interval callback
- `validation.js:16-20` - Prototype pollution key rejection

These remaining gaps are primarily:
1. Defensive error-catch wrappers that only fire on internal errors
2. Timer-based cleanup callbacks (hard to test deterministically)
3. Equality branch in sort comparators (requires identical timestamps)

## Test Types

- **Unit tests**: Store operations, evaluator, validation, sanitization, config
- **Integration tests (in-process)**: Route handlers via supertest
- **Integration tests (real HTTP)**: Full TCP server with native fetch
- **Cross-service integration**: Both APIs running simultaneously with concurrent requests
- **Frontend-backend integration**: web/test/integration-api.test.js verifies field mapping

## Field Name Verification

Tests explicitly verify correct API field names:
- Calculations: `id`, `title`, `expression`, `result`, `createdAt`, `updatedAt`
- Notes: `id`, `title`, `content`, `createdAt`, `updatedAt`
- List responses: `items`, `count`, `total`
- Error responses: `error.code`, `error.message`
- Stats: `totalCalculations`, `averageResult`, `minResult`, `maxResult`, `lastCalculatedAt`
