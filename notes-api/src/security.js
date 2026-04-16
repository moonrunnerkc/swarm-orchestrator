// Security middleware: headers and input sanitisation for a JSON-only API.

const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
});

export function securityHeaders(_req, res, next) {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, value);
  }
  next();
}

const MAX_REFLECTED_LENGTH = 200;

export function sanitiseForReflection(value) {
  if (typeof value !== "string") return String(value);
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, "");
  if (cleaned.length <= MAX_REFLECTED_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_REFLECTED_LENGTH) + "...";
}

export { SECURITY_HEADERS };
