// Integration tests that start a real notes-api HTTP server and exercise the
// frontend API client (web/src/api.js) against it. Verifies the field-name
// mapping (frontend "body" ↔ backend "content") works end-to-end over real
// network calls.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let server;
let baseUrl;
let tmpDir;
let api;

before(async () => {
  // Start a real notes-api server on an ephemeral port.
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "inkwell-integ-"));

  // Import notes-api makeApp from the sibling directory.
  const { makeApp } = await import("../../notes-api/src/app.js");
  const { app } = makeApp({
    config: {
      port: 0,
      host: "127.0.0.1",
      dataFile: path.join(tmpDir, "data.json"),
      corsOrigin: "*",
      logRequests: false,
      maxTitleLength: 200,
      maxContentLength: 10_000,
      maxBodyBytes: 65536,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 1000,
    },
  });

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://${addr.address}:${addr.port}`;
      resolve();
    });
  });

  // Patch the global fetch so the API client's relative URLs hit our server.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    // The api.js module uses relative paths like "/api/notes".
    // Rewrite them to absolute URLs pointing at our test server.
    // The notes-api mounts routes at /notes (not /api/notes), so adjust.
    if (typeof url === "string" && url.startsWith("/api/notes")) {
      url = baseUrl + url.replace("/api/notes", "/notes");
    }
    return realFetch(url, opts);
  };

  // Import the API module after patching fetch.
  api = await import("../src/api.js?integration");
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("frontend-to-backend integration (real HTTP)", () => {
  let createdId;

  it("createNote sends POST and returns note with correct field mapping", async () => {
    const note = await api.createNote({ title: "Integration Note", body: "markdown content here" });

    assert.ok(note.id, "should have an id");
    assert.equal(note.title, "Integration Note");
    assert.equal(note.body, "markdown content here");
    assert.equal(typeof note.createdAt, "number");
    assert.equal(typeof note.updatedAt, "number");
    assert.ok(note.createdAt > 0);

    createdId = note.id;
  });

  it("fetchNotes returns all notes from the backend", async () => {
    const notes = await api.fetchNotes();

    assert.ok(Array.isArray(notes));
    assert.ok(notes.length >= 1, "should have at least the note we created");
    const found = notes.find((n) => n.id === createdId);
    assert.ok(found, "created note should appear in list");
    assert.equal(found.title, "Integration Note");
    assert.equal(found.body, "markdown content here");
  });

  it("fetchNote returns a single note by id", async () => {
    const note = await api.fetchNote(createdId);

    assert.equal(note.id, createdId);
    assert.equal(note.title, "Integration Note");
    assert.equal(note.body, "markdown content here");
  });

  it("updateNote sends PUT with body→content mapping and returns updated note", async () => {
    const updated = await api.updateNote(createdId, {
      title: "Updated Title",
      body: "new markdown body",
    });

    assert.equal(updated.id, createdId);
    assert.equal(updated.title, "Updated Title");
    assert.equal(updated.body, "new markdown body");
    assert.ok(updated.updatedAt >= updated.createdAt);
  });

  it("partial update sends only changed fields", async () => {
    const updated = await api.updateNote(createdId, { body: "only body changed" });

    assert.equal(updated.title, "Updated Title", "title should remain unchanged");
    assert.equal(updated.body, "only body changed");
  });

  it("fetchNote reflects the latest update", async () => {
    const note = await api.fetchNote(createdId);

    assert.equal(note.body, "only body changed");
    assert.equal(note.title, "Updated Title");
  });

  it("deleteNote removes the note from the backend", async () => {
    await api.deleteNote(createdId);

    // Verify it's gone — fetchNote should throw with a 404-related error.
    await assert.rejects(() => api.fetchNote(createdId), (err) => {
      assert.ok(err.message.includes("not found") || err.message.includes("NOT_FOUND") || err.message.includes("404"),
        `Expected not-found error, got: ${err.message}`);
      return true;
    });
  });

  it("fetchNotes returns empty after deletion", async () => {
    const notes = await api.fetchNotes();
    const found = notes.find((n) => n.id === createdId);
    assert.equal(found, undefined, "deleted note should not appear in list");
  });

  // --- edge cases ---

  it("createNote with no arguments creates an Untitled note", async () => {
    const note = await api.createNote();
    assert.equal(note.title, "Untitled");
    assert.equal(note.body, "");
    // cleanup
    await api.deleteNote(note.id);
  });

  it("createNote with empty body sends empty content to backend", async () => {
    const note = await api.createNote({ title: "Empty Body", body: "" });
    assert.equal(note.body, "");
    const fetched = await api.fetchNote(note.id);
    assert.equal(fetched.body, "");
    await api.deleteNote(note.id);
  });

  it("handles multiple rapid creates correctly", async () => {
    const notes = await Promise.all([
      api.createNote({ title: "Rapid 1", body: "a" }),
      api.createNote({ title: "Rapid 2", body: "b" }),
      api.createNote({ title: "Rapid 3", body: "c" }),
    ]);

    assert.equal(notes.length, 3);
    const ids = notes.map((n) => n.id);
    assert.equal(new Set(ids).size, 3, "each note should have a unique id");

    // cleanup
    await Promise.all(ids.map((id) => api.deleteNote(id)));
  });

  it("rejects creating a note with invalid title type", async () => {
    await assert.rejects(
      () => api.createNote({ title: 123, body: "x" }),
      (err) => {
        assert.ok(err.message.includes("VALIDATION_ERROR") || err.message.includes("string") || err.message.includes("400"),
          `Expected validation error, got: ${err.message}`);
        return true;
      },
    );
  });
});
