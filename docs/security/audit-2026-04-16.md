# Security Audit Report

**Date:** 2026-04-16
**Auditor:** SecurityAuditor (automated)
**Scope:** app/ (Python FastAPI), calculations-api/ (Node.js Express), notes-api/ (Node.js Express), web/ (static frontend)

---

## Executive Summary

The codebase demonstrates strong security posture with defense-in-depth across all services. Security headers, input validation, rate limiting, error redaction, and safe expression evaluation are all well-implemented. This audit identified and remediated four medium-severity gaps. No critical or high-severity vulnerabilities were found.

---

## Findings and Remediations

### 1. Prototype Pollution via Request Bodies (Medium)

**Services:** calculations-api, notes-api
**Status:** FIXED

JSON request bodies could contain `__proto__`, `constructor`, or `prototype` keys. While `JSON.parse` in modern Node.js does not directly pollute prototypes, these keys propagated as own-properties through spread operators (`{...current, ...patch}`) in the store layer could confuse downstream consumers or libraries that walk prototype chains.

**Fix:** Added `rejectDangerousKeys()` validation to `validateCreateBody()` and `validateUpdateBody()` in both APIs. Requests containing `__proto__`, `constructor`, or `prototype` keys now receive a 400 response.

**Files changed:**
- `calculations-api/src/validation.js`
- `notes-api/src/validation.js`

### 2. Missing Request Correlation IDs (Medium)

**Services:** calculations-api, notes-api
**Status:** FIXED

Error handlers referenced `x-correlation-id` for log correlation but no middleware generated or propagated this header. This made it impossible to trace error logs back to specific HTTP requests during incident response.

**Fix:** Added `correlationId` middleware that generates a UUID per request (or accepts a client-supplied `X-Correlation-Id`), attaches it to `req.correlationId`, and echoes it in the response header. Wired as the first middleware in both app factories.

**Files changed:**
- `calculations-api/src/security.js`
- `calculations-api/src/app.js`
- `notes-api/src/security.js`
- `notes-api/src/app.js`

### 3. Web Frontend Missing Content Security Policy (Medium)

**Service:** web (Inkwell markdown editor)
**Status:** FIXED

The static HTML frontend had no Content-Security-Policy. When served via Python's `http.server` (or any static file server without custom headers), the browser applied no restrictions on script sources, enabling XSS if the page were served from a compromised origin.

**Fix:** Added a CSP meta tag to `web/index.html` with a restrictive policy:
- `default-src 'none'` (deny by default)
- `script-src 'self'` (only same-origin scripts)
- `style-src 'self'` (only same-origin styles)
- `img-src 'self' data: https:` (same-origin, data URIs for favicon, HTTPS images in markdown)
- `base-uri 'none'` (prevent base tag injection)
- `form-action 'none'` (no form submissions)
- `frame-ancestors 'none'` (prevent framing)

**Files changed:**
- `web/index.html`

### 4. Data File Permissions Too Permissive (Medium)

**Services:** calculations-api, notes-api
**Status:** FIXED

Data files written by the JSON store used the default process umask, which could result in world-readable files (e.g., `0o644`) depending on the deployment environment. Data files may contain user content that should not be accessible to other system users.

**Fix:** Changed `fs.writeFile` calls to explicitly set mode `0o600` (owner read/write only) on temporary files before atomic rename.

**Files changed:**
- `calculations-api/src/store.js`
- `notes-api/src/store.js`

---

## Existing Security Controls (Verified)

The following controls were reviewed and confirmed to be correctly implemented:

### Input Validation
- Request body type checking (must be JSON object, not array/primitive)
- Field type validation (string, number) with clear error messages
- Length limits on all string fields (expressions, titles, content)
- UUID v4 format enforcement on path parameters
- Expression evaluator uses recursive-descent parser (no `eval`/`Function`)
- Content-Type enforcement (POST/PUT/PATCH must be `application/json`)
- Request body size limits (16 KiB calculations, 64 KiB notes, 1 MiB health)

### Security Headers (All Services)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Cache-Control: no-store`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `X-Permitted-Cross-Domain-Policies: none`
- Server fingerprint removed (`x-powered-by` disabled, `Server: api`)

### Error Handling
- Typed error classes with consistent JSON response shape
- No stack traces leaked in production responses
- Credential redaction in error messages (URL userinfo, password/token/api_key patterns)
- Reflected input sanitised (control character stripping, length truncation)
- Generic 500 responses for unhandled exceptions

### Rate Limiting
- In-memory sliding-window rate limiter (100 req/60s per IP)
- `Retry-After` and `X-RateLimit-*` response headers
- Periodic cleanup of expired entries to prevent memory growth

### CORS
- Python health service validates origins at startup, rejects wildcard with credentials
- Node.js APIs default to wildcard (appropriate for public JSON APIs without credentials)

### Data Integrity
- Atomic file writes (temp file + rename) prevent corruption
- Serialized write queue prevents concurrent mutation conflicts
- Schema version field in data files for forward compatibility

### Markdown Renderer (web/)
- HTML-escapes all input before markdown expansion
- URL scheme allowlist (`https:`, `http:`, `mailto:`, relative paths only)
- `javascript:` and `data:` schemes blocked in links
- External links get `rel="noopener noreferrer" target="_blank"`

---

## Recommendations (Not Addressed - Low Priority)

1. **Pagination on list endpoints**: `GET /notes` and `GET /calculations` return all records. Consider adding `?limit=` and `?offset=` parameters to prevent large response bodies if record counts grow significantly.

2. **Structured logging**: Console-based logging could be replaced with structured JSON logging (e.g., pino) for better observability in production.

3. **Dependency scanning**: Consider adding `npm audit` and `pip-audit` to CI pipelines to catch known vulnerabilities in dependencies.

---

## Test Results

All existing tests pass with security changes applied:

| Service | Tests | Result |
|---|---|---|
| app (Python) | 59 | PASS |
| calculations-api | 123 | PASS |
| notes-api | 123 | PASS |
| calculator | 83 | PASS |
| web | 20 | PASS |
| tictactoe | 17 | PASS |
