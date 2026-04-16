// Request body validation for calculation endpoints.

import { ValidationError } from "./errors.js";
import { sanitiseForReflection } from "./security.js";

export function validateCreateBody(body, cfg) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("request body must be a JSON object");
  }

  const expression = validateExpression(body.expression, cfg);
  const title = validateTitle(body.title, cfg);

  return { expression, title };
}

export function validateUpdateBody(body, cfg) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("request body must be a JSON object");
  }

  const hasExpression = "expression" in body;
  const hasTitle = "title" in body;

  if (!hasExpression && !hasTitle) {
    throw new ValidationError(
      "at least one of 'title' or 'expression' must be provided",
      { fields: ["title", "expression"] },
    );
  }

  const result = {};
  if (hasExpression) result.expression = validateExpression(body.expression, cfg);
  if (hasTitle) result.title = validateTitle(body.title, cfg);

  return result;
}

function validateExpression(value, cfg) {
  if (typeof value !== "string") {
    throw new ValidationError(
      `'expression' must be a string, got ${typeof value}`,
      { field: "expression", received: typeof value },
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("'expression' must not be empty after trimming whitespace", {
      field: "expression",
    });
  }
  if (trimmed.length > cfg.maxExpressionLength) {
    throw new ValidationError(
      `'expression' exceeds maximum length of ${cfg.maxExpressionLength} characters (got ${trimmed.length})`,
      { field: "expression", maxLength: cfg.maxExpressionLength, length: trimmed.length },
    );
  }
  return trimmed;
}

function validateTitle(value, cfg) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError(
      `'title' must be a string or null, got ${typeof value}`,
      { field: "title", received: typeof value },
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > cfg.maxTitleLength) {
    throw new ValidationError(
      `'title' exceeds maximum length of ${cfg.maxTitleLength} characters (got ${trimmed.length})`,
      { field: "title", maxLength: cfg.maxTitleLength, length: trimmed.length },
    );
  }
  return trimmed.length === 0 ? null : trimmed;
}

export function validateUuid(raw, paramName = "id") {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(raw)) {
    const safeRaw = sanitiseForReflection(raw);
    throw new ValidationError(
      `'${paramName}' must be a valid UUID v4 (got "${safeRaw}")`,
      { field: paramName, received: safeRaw },
    );
  }
  return raw.toLowerCase();
}
