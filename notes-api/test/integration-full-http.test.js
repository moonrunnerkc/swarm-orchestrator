// Full integration tests making real HTTP calls against a live server.
// Validates the entire request lifecycle: TCP connection → middleware →
// routing → store → response, including field names, status codes, and
// error shapes as returned by the actual API.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { makeApp } from "../src/app.js";

// Helper: make a real HTTP request (no supertest, raw http module)
function httpRequest(baseUrl, method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {},
    };
    if (body !== null) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      options.headers["Content-Type"] = "application/json";
      options.headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on("error", reject);
    if (body !== null) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe("real HTTP integration (raw http module)", () => {
  let server;
  let baseUrl;
  let tmpDir;
  let store;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-fullhttp-"));
    const result = makeApp({
      config: {
        port: 0,
        host: "127.0.0.1",
        dataFile: path.join(tmpDir, "data.json"),
        corsOrigin: "*",
        logRequests: false,
        maxTitleLength: 200,
        maxContentLength: 10_000,
        maxBodyBytes: 65_536,
        rateLimitWindowMs: 60_000,
        rateLimitMax: 1000,
      },
    });
    store = result.store;

    server = result.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.on("listening", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /health returns correct fields via raw HTTP", async () => {
    const res = await httpRequest(baseUrl, "GET", "/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.service, "notes-api");
    assert.ok(typeof res.body.version === "string");
    assert.ok(typeof res.body.uptimeSeconds === "number");
    assert.ok(typeof res.body.timestamp === "string");
  });

  it("full CRUD lifecycle via raw HTTP calls", async () => {
    // CREATE
    const createRes = await httpRequest(baseUrl, "POST", "/notes", {
      title: "HTTP Test Note",
      content: "Created via raw HTTP",
    });
    assert.equal(createRes.status, 201);
    assert.ok(createRes.body.id);
    assert.equal(createRes.body.title, "HTTP Test Note");
    assert.equal(createRes.body.content, "Created via raw HTTP");
    assert.ok(createRes.body.createdAt);
    assert.ok(createRes.body.updatedAt);
    const noteId = createRes.body.id;

    // READ single
    const getRes = await httpRequest(baseUrl, "GET", `/notes/${noteId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.id, noteId);
    assert.equal(getRes.body.title, "HTTP Test Note");

    // LIST
    const listRes = await httpRequest(baseUrl, "GET", "/notes");
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body.items));
    assert.equal(listRes.body.count, listRes.body.items.length);
    assert.ok(listRes.body.items.some((n) => n.id === noteId));

    // UPDATE
    const updateRes = await httpRequest(baseUrl, "PUT", `/notes/${noteId}`, {
      title: "Updated Title",
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.title, "Updated Title");
    assert.equal(updateRes.body.content, "Created via raw HTTP");
    assert.equal(updateRes.body.id, noteId);
    assert.equal(updateRes.body.createdAt, createRes.body.createdAt);

    // DELETE
    const delRes = await httpRequest(baseUrl, "DELETE", `/notes/${noteId}`);
    assert.equal(delRes.status, 204);

    // CONFIRM GONE
    const goneRes = await httpRequest(baseUrl, "GET", `/notes/${noteId}`);
    assert.equal(goneRes.status, 404);
    assert.equal(goneRes.body.error.code, "NOT_FOUND");
    assert.equal(goneRes.body.error.details.resource, "note");
    assert.equal(goneRes.body.error.details.id, noteId);
  });

  it("POST with missing title returns 400 VALIDATION_ERROR", async () => {
    const res = await httpRequest(baseUrl, "POST", "/notes", { content: "no title" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
  });

  it("PUT with empty body returns 400 VALIDATION_ERROR", async () => {
    const createRes = await httpRequest(baseUrl, "POST", "/notes", { title: "tmp" });
    const res = await httpRequest(baseUrl, "PUT", `/notes/${createRes.body.id}`, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
  });

  it("GET unknown route returns 404 ROUTE_NOT_FOUND", async () => {
    const res = await httpRequest(baseUrl, "GET", "/nonexistent");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "ROUTE_NOT_FOUND");
  });

  it("PUT on nonexistent note returns 404 NOT_FOUND", async () => {
    const fakeId = "00000000-0000-4000-a000-000000000000";
    const res = await httpRequest(baseUrl, "PUT", `/notes/${fakeId}`, {
      title: "nope",
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("DELETE on nonexistent note returns 404 NOT_FOUND", async () => {
    const fakeId = "00000000-0000-4000-a000-000000000000";
    const res = await httpRequest(baseUrl, "DELETE", `/notes/${fakeId}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("security headers are present on real HTTP responses", async () => {
    const res = await httpRequest(baseUrl, "GET", "/health");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.ok(!res.headers["x-powered-by"]);
  });

  it("CORS header is present for wildcard origin", async () => {
    const res = await httpRequest(baseUrl, "GET", "/health");
    assert.equal(res.headers["access-control-allow-origin"], "*");
  });

  it("multiple concurrent creates don't lose data", async () => {
    await store.clear();
    const count = 10;
    const promises = Array.from({ length: count }, (_, i) =>
      httpRequest(baseUrl, "POST", "/notes", {
        title: `Concurrent ${i}`,
        content: `body ${i}`,
      }),
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.status, 201);
    }

    const listRes = await httpRequest(baseUrl, "GET", "/notes");
    assert.ok(listRes.body.count >= count);
  });
});
