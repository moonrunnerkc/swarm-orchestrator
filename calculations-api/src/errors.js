// Typed error classes and the Express error-handling middleware.
// Every error response has the same shape:
//   { error: { code, message, details? } }

import { sanitiseForReflection } from "./security.js";

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class ValidationError extends ApiError {
  constructor(message, details) {
    super(400, "VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends ApiError {
  constructor(resource, id) {
    super(404, "NOT_FOUND", `${resource} with id "${id}" was not found`, {
      resource,
      id,
    });
    this.name = "NotFoundError";
  }
}

export class EvaluationError extends ApiError {
  constructor(message, details) {
    super(422, "EVALUATION_ERROR", message, details);
    this.name = "EvaluationError";
  }
}

export function notFoundHandler(req, res) {
  // Sanitise the reflected URL to prevent XSS / response bloat when the
  // JSON body is rendered by a browser or log viewer.
  const safeUrl = sanitiseForReflection(req.originalUrl);
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `No route matches ${req.method} ${safeUrl}`,
    },
  });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof SyntaxError && "body" in err && err.status === 400) {
    return res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body is not valid JSON",
        details: { reason: err.message },
      },
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: `Request body exceeds the ${err.limit}-byte limit`,
      },
    });
  }

  if (err instanceof ApiError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return res.status(err.status).json(body);
  }

  const correlationId = res.getHeader("x-correlation-id");
  // eslint-disable-next-line no-console
  console.error("[calculations-api] unhandled error", {
    correlationId,
    method: req.method,
    url: req.originalUrl,
    message: err?.message,
    stack: err?.stack,
  });

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected server error occurred",
    },
  });
}
