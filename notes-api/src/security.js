// Security middleware: headers and input sanitisation for a JSON-only API.

import { randomUUID } from "node:crypto";

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
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
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

// Reject mutation requests that do not declare a JSON content type.
// Prevents accidental or malicious submission of form-encoded data.
const METHODS_REQUIRING_JSON = new Set(["POST", "PUT", "PATCH"]);

export function requireJsonContentType(req, res, next) {
  if (METHODS_REQUIRING_JSON.has(req.method)) {
    const ct = req.headers["content-type"] || "";
    if (!ct.includes("application/json")) {
      return res.status(415).json({
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json",
        },
      });
    }
  }
  next();
}

// Simple in-memory rate limiter. No external dependencies.
// Tracks request counts per IP in a sliding window.
export function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 100,
} = {}) {
  const hits = new Map();

  // Periodically purge expired entries to prevent memory growth.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start >= windowMs) hits.delete(key);
    }
  }, windowMs).unref();

  function middleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let entry = hits.get(ip);

    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(ip, entry);
    }

    entry.count += 1;

    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, maxRequests - entry.count)));

    if (entry.count > maxRequests) {
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests — try again later",
        },
      });
    }

    next();
  }

  middleware.destroy = () => clearInterval(cleanup);
  return middleware;
}

// Attach a unique correlation ID to every request so errors logged
// server-side can be traced back to the originating HTTP request.
// Clients may supply their own via X-Correlation-Id; otherwise one is
// generated. The ID is echoed in the response for client-side correlation.
// Correlation IDs must be safe for headers and log output. Accept only
// printable ASCII, capped at 128 chars, to prevent header/log injection.
const SAFE_CORRELATION_RE = /^[\x20-\x7e]{1,128}$/;

export function correlationId(req, res, next) {
  const supplied = req.headers["x-correlation-id"];
  const id = (supplied && SAFE_CORRELATION_RE.test(supplied)) ? supplied : randomUUID();
  req.correlationId = id;
  res.setHeader("X-Correlation-Id", id);
  next();
}

export { SECURITY_HEADERS };
