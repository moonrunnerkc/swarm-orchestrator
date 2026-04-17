// Cross-service integration test verifying the frontend API client contract.
// Starts a real HTTP server and makes actual network requests mimicking how
// the web frontend (web/src/api.js) calls the notes-api backend. Ensures
// field name mapping (content ↔ body) and full CRUD lifecycle work end-to-end.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeApp } from "../src/app.js";

let server;
let baseUrl;
let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-cross-"));
  const { app } = makeApp({
    config: {
      port: 0,
      host: "127.0.0.1",
      dataFile: path.join(tmpDir, "data.json"),
      corsOrigin: "*",
      logRequests: false,
      rateLimitWindowMs: 60000,
      rateLimitMax: 1000,
      maxTitleLength: 200,
      maxContentLength: 10_000,
      maxBodyBytes: 65536,
    },
  });

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://${addr.address}:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

// Mirrors the frontend's toLocal / toRemoteCreate / toRemoteUpdate mapping
// from web/src/api.js so we can verify the contract holds.
const toLocal = (remote) => ({
  id: remote.id,
  title: remote.title,
  body: remote.content ?? "",
  createdAt: new Date(remote.createdAt).getTime(),
  updatedAt: new Date(remote.updatedAt).getTime(),
});

const toRemoteCreate = (note) => ({
  title: note.title || "Untitled",
  content: note.body ?? "",
});

const toRemoteUpdate = (patch) => {
  const out = {};
  if ("title" in patch) out.title = patch.title || "Untitled";
  if ("body" in patch) out.content = patch.body;
  return out;
};

const headers = { "Content-Type": "application/json" };

const request = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error?.message || `API error ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
};

describe("frontend ↔ backend contract (real HTTP)", () => {
  it("full lifecycle: create → fetch list → get single → update → delete", async () => {
    // 1) Create a note using the same mapping the frontend uses
    const frontendNote = { title: "My Note", body: "Some content" };
    const createPayload = toRemoteCreate(frontendNote);
    assert.strictEqual(createPayload.title, "My Note");
    assert.strictEqual(createPayload.content, "Some content");

    const created = await request(`${baseUrl}/notes`, {
      method: "POST",
      body: JSON.stringify(createPayload),
    });

    // Verify API response has correct field names
    assert.strictEqual(typeof created.id, "string");
    assert.strictEqual(created.title, "My Note");
    assert.strictEqual(created.content, "Some content");  // backend uses 'content', not 'body'
    assert.strictEqual(typeof created.createdAt, "string");
    assert.strictEqual(typeof created.updatedAt, "string");
    assert.strictEqual(created.body, undefined);  // 'body' is NOT a backend field

    // Map to local form as frontend would
    const local = toLocal(created);
    assert.strictEqual(local.body, "Some content");  // frontend maps content → body
    assert.strictEqual(typeof local.createdAt, "number");  // frontend converts to timestamp

    // 2) Fetch all notes - mimics fetchNotes()
    const listData = await request(`${baseUrl}/notes`);
    assert.ok(Array.isArray(listData.items));
    assert.strictEqual(typeof listData.count, "number");
    assert.strictEqual(typeof listData.total, "number");
    const found = listData.items.find((n) => n.id === created.id);
    assert.ok(found, "created note should appear in list");
    assert.strictEqual(found.content, "Some content");

    // 3) Fetch single note - mimics fetchNote(id)
    const single = await request(`${baseUrl}/notes/${created.id}`);
    assert.strictEqual(single.id, created.id);
    assert.strictEqual(single.title, "My Note");
    assert.strictEqual(single.content, "Some content");

    // 4) Update - mimics updateNote(id, patch)
    const updatePatch = { body: "Updated content" };
    const remoteUpdatePayload = toRemoteUpdate(updatePatch);
    assert.strictEqual(remoteUpdatePayload.content, "Updated content");
    assert.strictEqual(remoteUpdatePayload.title, undefined);  // only 'body' was in patch

    const updated = await request(`${baseUrl}/notes/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(remoteUpdatePayload),
    });
    assert.strictEqual(updated.content, "Updated content");
    assert.strictEqual(updated.title, "My Note");  // title unchanged

    // 5) Delete - mimics deleteNote(id)
    const delRes = await fetch(`${baseUrl}/notes/${created.id}`, {
      method: "DELETE",
      headers,
    });
    assert.strictEqual(delRes.status, 204);

    // Verify deleted
    try {
      await request(`${baseUrl}/notes/${created.id}`);
      assert.fail("should have thrown for deleted note");
    } catch (err) {
      assert.ok(err.message.includes("not found") || err.message.includes("API error 404"));
    }
  });

  it("creates note with empty body (frontend default)", async () => {
    const frontendNote = { title: "No Body" };
    const payload = toRemoteCreate(frontendNote);
    assert.strictEqual(payload.content, "");  // frontend defaults body to ""

    const created = await request(`${baseUrl}/notes`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assert.strictEqual(created.content, "");
  });

  it("creates note with 'Untitled' when title is empty", async () => {
    const frontendNote = { title: "", body: "some text" };
    const payload = toRemoteCreate(frontendNote);
    assert.strictEqual(payload.title, "Untitled");  // frontend maps "" → "Untitled"

    const created = await request(`${baseUrl}/notes`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assert.strictEqual(created.title, "Untitled");
  });

  it("list endpoint returns items array, count, and total", async () => {
    const data = await request(`${baseUrl}/notes`);
    assert.ok(Array.isArray(data.items));
    assert.strictEqual(typeof data.count, "number");
    assert.strictEqual(typeof data.total, "number");
    assert.strictEqual(data.count, data.items.length);
  });

  it("error responses have { error: { code, message } } shape", async () => {
    const res = await fetch(`${baseUrl}/notes`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),  // missing required title
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
    assert.strictEqual(typeof body.error.code, "string");
    assert.strictEqual(typeof body.error.message, "string");
  });
});
