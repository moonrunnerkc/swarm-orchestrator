# Security Audit Report

**Date:** 2026-04-16
**Scope:** `app/` (Python/FastAPI health service), `calculations-api/` (Node.js/Express CRUD API)

---

## Findings and Fixes

### HIGH: Missing security headers on calculations-api responses

**Before:** The Express app only disabled `x-powered-by`. All other security
headers were absent, leaving the API exposed to MIME-sniffing, clickjacking,
and cross-origin data leaks.

**Fix:** Added `calculations-api/src/security.js` with a `securityHeaders`
middleware that sets the same conservative header set already present on the
Python service:

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

The middleware is wired before CORS and route handlers in `app.js`.

---

### MEDIUM: Unsanitised user input reflected in error responses

**Before:** The 404 handler reflected `req.originalUrl` verbatim, and UUID
validation echoed back the raw parameter value. Malicious input (control
characters, oversized strings) could appear in JSON error bodies, creating an
XSS vector if the response is rendered by a browser or log viewer.

**Fix:** Added a `sanitiseForReflection()` utility that strips ASCII control
characters and truncates input to 200 characters. Applied to:

- `errors.js` — `notFoundHandler` now sanitises `req.originalUrl`
- `validation.js` — `validateUuid` now sanitises the raw parameter value

---

## Pre-existing Security Posture (no changes needed)

### Python health service (`app/`)

The FastAPI service already implements defence-in-depth:

- **Security headers middleware** — all OWASP-recommended headers
- **Body-size enforcement** — 1 MiB limit via Content-Length check
- **Error redaction** — credentials stripped from SQLAlchemy error messages,
  truncated to 200 chars
- **Generic 500 handler** — tracebacks never leak to clients
- **CORS validation** — rejects wildcard origins with credentials, requires
  scheme prefix
- **Database parameter hiding** — `hide_parameters=True` on SQLAlchemy engine
- **Pydantic validation** — Literal enums, ge=0 constraints, typed fields

### calculations-api (pre-existing strengths)

- **Safe expression evaluator** — recursive-descent parser, no `eval()` or
  `Function()`, division-by-zero caught
- **Input validation** — type checking, length limits, UUID v4 format
  enforcement
- **Atomic file writes** — rename-over prevents corruption
- **Structured error responses** — consistent `{ error: { code, message } }`
  shape
- **Body-size limit** — 16 KB via `express.json({ limit })`
- **Frozen configuration** — `Object.freeze()` on config

---

## Recommendations (future work, not addressed in this audit)

1. **Rate limiting** — Neither service implements rate limiting. Consider
   `express-rate-limit` for the calculations-api and a similar ASGI middleware
   for the FastAPI service.

2. **CORS tightening on calculations-api** — The default CORS origin is `*`.
   For production, set `CORS_ORIGIN` to explicit allowed origins.

3. **Request logging / correlation IDs** — The error handler references
   `x-correlation-id` but no middleware generates it. Consider adding a
   correlation-ID middleware for traceability.

---

## Test Results

All existing tests pass after security changes:

- **calculations-api:** 60/60 passed
- **app/ (Python):** 59/59 passed
