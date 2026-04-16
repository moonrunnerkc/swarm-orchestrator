// Security middleware: headers, input sanitisation, and request hardening.

// Conservative security headers for a JSON-only API. Mirrors the hardening
// applied to the Python health-service so both backends present a consistent
// security posture to scanners and browsers.
const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
  // HSTS — browsers ignore it on plain HTTP, safe to always advertise.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
});

/**
 * Express middleware that sets security headers on every response.
 */
export function securityHeaders(_req, res, next) {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, value);
  }
  next();
}

// Cap reflected strings to prevent response bloat and limit XSS surface
// when error messages are rendered by a browser or log viewer.
const MAX_REFLECTED_LENGTH = 200;

/**
 * Truncate and strip control characters from a string before reflecting
 * it in an error response. Prevents oversized or malicious input from
 * appearing verbatim in JSON error bodies.
 */
export function sanitiseForReflection(value) {
  if (typeof value !== "string") return String(value);
  // Strip ASCII control characters (0x00-0x1F, 0x7F) except space.
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, "");
  if (cleaned.length <= MAX_REFLECTED_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_REFLECTED_LENGTH) + "...";
}

export { SECURITY_HEADERS };
