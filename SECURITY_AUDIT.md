# Security Audit Report

**Date:** 2026-04-16
**Scope:** `app/` (Python/FastAPI health service), `calculations-api/` (Node.js/Express CRUD API), `notes-api/` (Node.js/Express CRUD API)

---

## Fixes Applied in This Audit

### 1. MEDIUM: Missing `Permissions-Policy` header (all services)

**Before:** None of the three services set the `Permissions-Policy` header,
leaving browser-side feature access unrestricted when responses are rendered
in a browser context.

**Fix:** Added `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
to the security headers middleware in all three services:

- `notes-api/src/security.js`
- `calculations-api/src/security.js`
- `app/security.py`

This restricts browser APIs that a JSON-only API has no business requesting.

---

### 2. MEDIUM: No rate limiting (Express services)

**Before:** Both Express APIs accepted unlimited requests per client, making
them vulnerable to denial-of-service and brute-force attacks.

**Fix:** Added an in-memory sliding-window rate limiter to both Express apps
(no new dependencies). Configurable via `rateLimitWindowMs` (default 60s) and
`rateLimitMax` (default 100 requests/window).

- Returns `429 Too Many Requests` with `Retry-After` header when limit exceeded
- Exposes `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers on every response
- Periodic cleanup prevents memory growth from stale entries
- Files: `notes-api/src/security.js`, `calculations-api/src/security.js`

---

### 3. MEDIUM: No Content-Type enforcement on mutation routes (Express services)

**Before:** POST/PUT/PATCH requests without `Content-Type: application/json`
would pass through to `express.json()` which silently skips parsing, leaving
`req.body` as `undefined`. While downstream validation catches this, the error
message is confusing ("request body must be a JSON object" instead of a clear
media type error).

**Fix:** Added `requireJsonContentType` middleware that returns `415 Unsupported
Media Type` for POST/PUT/PATCH requests missing `application/json` content type.
Applied before `express.json()` in both Express apps.

- Files: `notes-api/src/security.js`, `calculations-api/src/security.js`

---

## Previously Applied Fixes (from earlier audit pass)

### HIGH: Missing security headers on calculations-api responses

Added `securityHeaders` middleware with the full OWASP-recommended header set.

### MEDIUM: Unsanitised user input reflected in error responses

Added `sanitiseForReflection()` to strip control characters and truncate
reflected input. Applied to 404 handler and UUID validation in both Express APIs.

---

## Pre-existing Security Posture (no changes needed)

### Python health service (`app/`)

- **Security headers middleware** -- all OWASP-recommended headers
- **Body-size enforcement** -- 1 MiB limit via Content-Length check
- **Error redaction** -- credentials stripped from SQLAlchemy error messages,
  truncated to 200 chars
- **Generic 500 handler** -- tracebacks never leak to clients
- **CORS validation** -- rejects wildcard origins with credentials, requires
  scheme prefix
- **Database parameter hiding** -- `hide_parameters=True` on SQLAlchemy engine
- **Pydantic validation** -- Literal enums, ge=0 constraints, typed fields

### Express APIs (notes-api, calculations-api) -- pre-existing strengths

- **Safe expression evaluator** (calculations-api) -- recursive-descent parser,
  no `eval()` or `Function()`, division-by-zero caught
- **Input validation** -- type checking, length limits, UUID v4 format enforcement
- **Atomic file writes** -- rename-over prevents data corruption
- **Structured error responses** -- consistent `{ error: { code, message } }` shape
- **Body-size limits** -- 16 KB (calculations) / 64 KB (notes)
- **Frozen configuration** -- `Object.freeze()` prevents runtime mutation
- **x-powered-by disabled** -- no server fingerprinting

---

## Security Headers Summary (all services)

| Header | Value |
|---|---|
| X-Content-Type-Options | nosniff |
| X-Frame-Options | DENY |
| Referrer-Policy | no-referrer |
| Content-Security-Policy | default-src 'none'; frame-ancestors 'none' |
| X-Permitted-Cross-Domain-Policies | none |
| Cross-Origin-Opener-Policy | same-origin |
| Cross-Origin-Resource-Policy | same-origin |
| Cache-Control | no-store |
| Strict-Transport-Security | max-age=63072000; includeSubDomains |
| Permissions-Policy | camera=(), microphone=(), geolocation=(), payment=() |

---

## Recommendations (future work)

1. **CORS tightening** -- Both Express APIs default CORS origin to `*`. For
   production, set `CORS_ORIGIN` to explicit allowed origins.

2. **Correlation IDs** -- The error handler references `x-correlation-id` but
   no middleware generates it. Consider adding correlation-ID middleware for
   request traceability.

3. **Dependency scanning** -- Set up `npm audit` and `pip-audit` in CI to catch
   known vulnerabilities in transitive dependencies.

4. **Distributed rate limiting** -- The current in-memory rate limiter is
   per-process. For multi-instance deployments, consider Redis-backed rate
   limiting.

---

## Test Results

All existing tests pass after security changes:

- **notes-api:** 100/100 passed
- **calculations-api:** 118/118 passed
- **app/ (Python):** 59/59 passed
- **Total:** 277 tests, 0 failures
