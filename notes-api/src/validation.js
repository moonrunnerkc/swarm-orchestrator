// Request body validation for note endpoints.

import { ValidationError } from "./errors.js";
import { sanitiseForReflection } from "./security.js";

export function validateCreateBody(body, cfg) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("request body must be a JSON object");
  }

  const title = validateTitle(body.title, cfg, { required: true });
  const content = validateContent(body.content, cfg);

  return { title, content };
}

export function validateUpdateBody(body, cfg) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("request body must be a JSON object");
  }

  const hasTitle = "title" in body;
  const hasContent = "content" in body;

  if (!hasTitle && !hasContent) {
    throw new ValidationError(
      "at least one of 'title' or 'content' must be provided",
      { fields: ["title", "content"] },
    );
  }

  const result = {};
  if (hasTitle) result.title = validateTitle(body.title, cfg, { required: true });
  if (hasContent) result.content = validateContent(body.content, cfg);

  return result;
}

function validateTitle(value, cfg, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      throw new ValidationError("'title' is required", { field: "title" });
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError(
      `'title' must be a string, got ${typeof value}`,
      { field: "title", received: typeof value },
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("'title' must not be empty after trimming whitespace", {
      field: "title",
    });
  }
  if (trimmed.length > cfg.maxTitleLength) {
    throw new ValidationError(
      `'title' exceeds maximum length of ${cfg.maxTitleLength} characters (got ${trimmed.length})`,
      { field: "title", maxLength: cfg.maxTitleLength, length: trimmed.length },
    );
  }
  return trimmed;
}

function validateContent(value, cfg) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new ValidationError(
      `'content' must be a string, got ${typeof value}`,
      { field: "content", received: typeof value },
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > cfg.maxContentLength) {
    throw new ValidationError(
      `'content' exceeds maximum length of ${cfg.maxContentLength} characters (got ${trimmed.length})`,
      { field: "content", maxLength: cfg.maxContentLength, length: trimmed.length },
    );
  }
  return trimmed;
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
