// Unit tests for error classes and the Express error-handling middleware.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  ValidationError,
  NotFoundError,
  notFoundHandler,
  errorHandler,
} from "../src/errors.js";

describe("ApiError", () => {
  it("sets status, code, message, and details", () => {
    const err = new ApiError(418, "TEAPOT", "I'm a teapot", { brew: "earl grey" });
    assert.strictEqual(err.status, 418);
    assert.strictEqual(err.code, "TEAPOT");
    assert.strictEqual(err.message, "I'm a teapot");
    assert.deepStrictEqual(err.details, { brew: "earl grey" });
    assert.ok(err instanceof Error);
  });

  it("omits details when not provided", () => {
    const err = new ApiError(500, "OOPS", "something broke");
    assert.strictEqual(err.details, undefined);
  });
});

describe("ValidationError", () => {
  it("has status 400 and VALIDATION_ERROR code", () => {
    const err = new ValidationError("bad input", { field: "x" });
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.code, "VALIDATION_ERROR");
    assert.strictEqual(err.message, "bad input");
    assert.deepStrictEqual(err.details, { field: "x" });
    assert.ok(err instanceof ApiError);
  });
});

describe("NotFoundError", () => {
  it("has status 404 and includes resource and id in details", () => {
    const err = new NotFoundError("note", "abc-123");
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.code, "NOT_FOUND");
    assert.match(err.message, /note.*abc-123/);
    assert.deepStrictEqual(err.details, { resource: "note", id: "abc-123" });
    assert.ok(err instanceof ApiError);
  });
});

function mockReq(overrides = {}) {
  return { method: "GET", originalUrl: "/test", ...overrides };
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
    getHeader(name) {
      return res.headers[name];
    },
  };
  return res;
}

describe("notFoundHandler", () => {
  it("returns 404 with ROUTE_NOT_FOUND and includes method/url", () => {
    const req = mockReq({ method: "POST", originalUrl: "/foo/bar" });
    const res = mockRes();
    notFoundHandler(req, res);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.error.code, "ROUTE_NOT_FOUND");
    assert.match(res.body.error.message, /POST \/foo\/bar/);
  });
});

describe("errorHandler", () => {
  it("handles SyntaxError (malformed JSON) with INVALID_JSON", () => {
    const err = new SyntaxError("Unexpected token");
    err.status = 400;
    err.body = "";
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error.code, "INVALID_JSON");
  });

  it("handles entity.too.large with PAYLOAD_TOO_LARGE", () => {
    const err = { type: "entity.too.large", limit: 65536 };
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    assert.strictEqual(res.statusCode, 413);
    assert.strictEqual(res.body.error.code, "PAYLOAD_TOO_LARGE");
    assert.match(res.body.error.message, /65536/);
  });

  it("handles ApiError subclasses with correct status and body", () => {
    const err = new ValidationError("bad field", { field: "title" });
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    assert.strictEqual(res.body.error.message, "bad field");
    assert.deepStrictEqual(res.body.error.details, { field: "title" });
  });

  it("handles ApiError without details (no details key in response)", () => {
    const err = new ApiError(409, "CONFLICT", "already exists");
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.error.details, undefined);
  });

  it("handles unknown errors with 500 INTERNAL_ERROR", () => {
    const err = new TypeError("oops");
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.error.code, "INTERNAL_ERROR");
    assert.strictEqual(res.body.error.message, "An unexpected server error occurred");
  });
});
