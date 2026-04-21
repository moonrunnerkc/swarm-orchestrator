# Security Audit Report

**Date:** 2026-04-17 (Step 3 audit)
**Prior audit:** 2026-04-16
**Scope:** `app/` (Python/FastAPI), `calculations-api/` (Node.js/Express), `notes-api/` (Node.js/Express), `web/` (dev server + frontend)

---

## Fixes Applied in This Audit — Step 3 (2026-04-17)

### 5. HIGH: Shallow prototype pollution check (CWE-1321)

**Before:** `rejectDangerousKeys()` in both Express APIs only checked top-level
object keys for dangerous properties (`__proto__`, `constructor`, `prototype`).
Nested objects bypassed the check entirely, allowing payloads like
`{"title": "ok", "nested": {"__proto__": {"isAdmin": true}}}` to pass.

**Fix:** Made `rejectDangerousKeys()` recursive with a max depth of 10 to
prevent stack overflow on maliciously deep payloads. Objects nested beyond
the limit are rejected with a validation error.

- Files: `notes-api/src/validation.js`, `calculations-api/src/validation.js`

---

### 6. HIGH: Dev-server crash on malformed URLs (CWE-20)

**Before:** `decodeURIComponent()` throws `URIError` on malformed percent-
encoding (e.g., `/%zz`). No try-catch existed, causing the server process to
crash on a single malformed request — a trivial denial-of-service vector.

**Fix:** Wrapped `decodeURIComponent` in try-catch, returning HTTP 400 with
security headers on malformed URLs.

- File: `web/dev-server.js`

---

### 7. MEDIUM: Missing Server header in Node.js APIs (CWE-200)

**Before:** The Python health-service set `Server: api` to prevent technology
fingerprinting, but both Node.js APIs did not override this header, creating
an inconsistent security posture across services.

**Fix:** Added `Server: api` to the `SECURITY_HEADERS` object in both APIs.

- Files: `notes-api/src/security.js`, `calculations-api/src/security.js`

---

### 8. MEDIUM: Query parameter type confusion (CWE-843)

**Before:** Express parses duplicate query keys (`?sort=a&sort=b`) as arrays.
Direct comparison (`=== "asc"`) and `parseInt()` on arrays produce unexpected
results, potentially bypassing intended sorting/pagination logic.

**Fix:** Added `qstr()` helper to coerce query parameters to single strings.

- Files: `notes-api/src/routes/notes.js`, `calculations-api/src/routes/calculations.js`

---

### 9. MEDIUM: Proxy error responses missing security headers (CWE-693)

**Before:** When the upstream notes-api was unreachable, the web dev-server
returned HTTP 502 without security headers, unlike all other response paths.

**Fix:** Added `SECURITY_HEADERS` spread to the proxy error response.

- File: `web/dev-server.js`

---

## Fixes Applied in This Audit — Step 2 (2026-04-17)

### 1. HIGH: Path traversal in `web/dev-server.js`

**Before:** The `serveStatic` function joined the user-supplied URL path with
`__dirname` using `path.join()` but never validated the resolved path stayed
within the web root. Encoded `/../` sequences (e.g., `GET /%2e%2e/etc/passwd`)
could read arbitrary files from the filesystem.

**Fix:** Resolve with `path.resolve()` and verify the result starts with
`__dirname + path.sep`. Returns 403 Forbidden for any path that escapes the
web root. Also added `decodeURIComponent()` to ensure encoded traversal
sequences are caught.

- File: `web/dev-server.js`

---

### 2. MEDIUM: Missing security headers on `web/dev-server.js`

**Before:** The dev server served HTML, CSS, and JS without any security
headers, leaving the frontend vulnerable to clickjacking, MIME-sniffing, and
other browser-side attacks.

**Fix:** Added security headers to all responses from the dev server:
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Content-Security-Policy`, `X-Permitted-Cross-Domain-Policies`,
`Permissions-Policy`.

- File: `web/dev-server.js`

---

### 3. MEDIUM: Unsanitised correlation ID header (Express APIs)

**Before:** Both Express APIs accepted arbitrary `X-Correlation-Id` header
values from clients and echoed them verbatim in response headers and error
logs. Malicious values containing control characters, newlines, or excessive
length could enable HTTP header injection or log injection attacks.

**Fix:** Validate client-supplied correlation IDs against a strict pattern:
printable ASCII only (`[\x20-\x7e]`), max 128 characters. Invalid or missing
values fall back to a generated UUID.

- Files: `notes-api/src/security.js`, `calculations-api/src/security.js`

---

### 4. MEDIUM: No upper bound on pagination `limit` parameter

**Before:** Both Express APIs accepted arbitrarily large `limit` query
parameter values, allowing clients to request the entire dataset in a single
response regardless of size.

**Fix:** Capped `limit` at 100 items per page (`MAX_PAGE_SIZE`). Requests
exceeding this are silently clamped rather than rejected, preserving backward
compatibility.

- Files: `notes-api/src/routes/notes.js`, `calculations-api/src/routes/calculations.js`

---

## Fixes Applied in Prior Audit (2026-04-16)

### MEDIUM: Missing `Permissions-Policy` header (all services)

Added `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
to all three backend services.

### MEDIUM: No rate limiting (Express services)

Added in-memory sliding-window rate limiter (100 req/60s per IP) to both
Express APIs.

### MEDIUM: No Content-Type enforcement on mutation routes

Added `requireJsonContentType` middleware returning 415 for non-JSON mutation
requests.

### HIGH: Missing security headers on calculations-api

Added full OWASP-recommended security header set.

### MEDIUM: Unsanitised user input reflected in error responses

Added `sanitiseForReflection()` — control char stripping + 200-char truncation.

---

## Pre-existing Security Posture (no changes needed)

### Python health service (`app/`)

- **Security headers middleware** — all OWASP-recommended headers
- **Body-size enforcement** — 1 MiB limit via Content-Length check
- **Error redaction** — credentials stripped from error messages, truncated to 200 chars
- **Generic 500 handler** — tracebacks never leak to clients
- **CORS validation** — rejects wildcard origins with credentials
- **Database parameter hiding** — `hide_parameters=True` on SQLAlchemy engine
- **Pydantic validation** — typed fields with constraints

### Express APIs (notes-api, calculations-api)

- **Safe expression evaluator** (calculations-api) — recursive-descent parser, no `eval()`
- **Input validation** — type checking, length limits, UUID v4 format enforcement
- **Prototype pollution protection** — rejects `__proto__`, `constructor`, `prototype` keys
- **Atomic file writes** — rename-over prevents data corruption
- **Structured error responses** — consistent `{ error: { code, message } }` shape
- **Body-size limits** — 16 KB (calculations) / 64 KB (notes)
- **Frozen configuration** — `Object.freeze()` prevents runtime mutation
- **x-powered-by disabled** — no server fingerprinting

### Frontend (`web/`)

- **HTML escaping** — markdown renderer escapes all HTML before expansion
- **URL scheme allowlist** — only `https:`, `http:`, `mailto:`, relative paths allowed
- **Safe link attributes** — `rel="noopener noreferrer"` on external links

---

## Security Headers Summary

### Backend APIs (all three services)

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

### Dev server (`web/`)

| Header | Value |
|---|---|
| X-Content-Type-Options | nosniff |
| X-Frame-Options | DENY |
| Referrer-Policy | no-referrer |
| Content-Security-Policy | default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none' |
| X-Permitted-Cross-Domain-Policies | none |
| Permissions-Policy | camera=(), microphone=(), geolocation=(), payment=() |

---

## Recommendations (future work)

1. **CORS tightening** — Both Express APIs default CORS origin to `*`. For
   production, set `CORS_ORIGIN` to explicit allowed origins.

2. **Dependency scanning** — Set up `npm audit` and `pip-audit` in CI to catch
   known vulnerabilities in transitive dependencies.

3. **Distributed rate limiting** — The current in-memory rate limiter is
   per-process. For multi-instance deployments, consider Redis-backed limiting.

4. **HTTPS enforcement** — Dev server listens on plain HTTP. Production
   deployments should terminate TLS upstream or add HTTPS support.

---

## Test Results

All existing tests pass after security changes (Step 3):

- **notes-api:** 160/160 passed
- **calculations-api:** 158/158 passed
- **web:** 64/64 passed
- **app/ (Python):** 59/59 passed
- **calculator:** 83/83 passed
