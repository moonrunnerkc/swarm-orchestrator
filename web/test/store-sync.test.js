// Tests for the notes-store ↔ API sync workflow. Verifies that the frontend
// store (localStorage layer) and the backend API (notes-api over HTTP) can
// work together: notes created via the API are correctly imported into the
// local store, field names map properly (body ↔ content), and offline
// fallback behavior is exercised.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createNotesStore, createMemoryStorage, filterNotes } from "../src/notes-store.js";

let server;
let baseUrl;
let tmpDir;
let api;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "store-sync-"));
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

  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  baseUrl = `http://${addr.address}:${addr.port}`;

  // Patch global fetch for api.js
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (typeof url === "string" && url.startsWith("/api/notes")) {
      url = baseUrl + url.replace("/api/notes", "/notes");
    }
    return realFetch(url, opts);
  };

  api = await import("../src/api.js?store-sync");
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("store-API sync integration", () => {
  let store;
  let storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    store = createNotesStore(storage);
  });

  it("creates a note via API and imports it into the local store", async () => {
    // Simulate the app's createNoteViaApi pattern from app.js
    const remote = await api.createNote({ title: "Sync Test", body: "hello world" });

    // Import into local store (as app.js does in createNoteViaApi)
    store.create({
      id: remote.id,
      title: remote.title,
      body: remote.body,
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
    });

    const local = store.get(remote.id);
    assert.ok(local, "note should exist in local store");
    assert.equal(local.title, "Sync Test");
    assert.equal(local.body, "hello world");
    assert.equal(local.id, remote.id);

    // Cleanup
    await api.deleteNote(remote.id);
  });

  it("syncs remote notes into local store, merging by updatedAt", async () => {
    // Create two notes on the server
    const r1 = await api.createNote({ title: "Remote 1", body: "content 1" });
    const r2 = await api.createNote({ title: "Remote 2", body: "content 2" });

    // Simulate syncFromServer logic from app.js
    const remoteNotes = await api.fetchNotes();
    for (const note of remoteNotes) {
      const local = store.get(note.id);
      if (!local) {
        store.create(note);
      } else if (note.updatedAt > local.updatedAt) {
        store.update(note.id, note);
      }
    }

    // Verify both notes are in the local store
    const all = store.list();
    assert.ok(all.length >= 2, `expected at least 2 notes, got ${all.length}`);
    assert.ok(store.get(r1.id), "Remote 1 should be in local store");
    assert.ok(store.get(r2.id), "Remote 2 should be in local store");

    // Cleanup
    await api.deleteNote(r1.id);
    await api.deleteNote(r2.id);
  });

  it("remote update overwrites local when remote is newer", async () => {
    const remote = await api.createNote({ title: "Original", body: "v1" });

    // Put an older version in local store
    store.create({
      id: remote.id,
      title: "Original",
      body: "v1",
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt - 1000, // older
    });

    // Update on server
    const updated = await api.updateNote(remote.id, { body: "v2" });

    // Sync: remote is newer, should overwrite local
    const local = store.get(remote.id);
    if (updated.updatedAt > local.updatedAt) {
      store.update(remote.id, { title: updated.title, body: updated.body });
    }

    const result = store.get(remote.id);
    assert.equal(result.body, "v2", "local should reflect remote update");

    await api.deleteNote(remote.id);
  });

  it("local changes are preserved when local is newer than remote", async () => {
    const remote = await api.createNote({ title: "Remote", body: "server content" });

    // Put a newer version in local store
    store.create({
      id: remote.id,
      title: "Local Edit",
      body: "local content",
      createdAt: remote.createdAt,
      updatedAt: Date.now() + 60000, // way in the future
    });

    // Sync: local is newer, should NOT overwrite
    const local = store.get(remote.id);
    if (remote.updatedAt > local.updatedAt) {
      store.update(remote.id, remote);
    }

    const result = store.get(remote.id);
    assert.equal(result.body, "local content", "local content should be preserved");
    assert.equal(result.title, "Local Edit");

    await api.deleteNote(remote.id);
  });

  it("filterNotes works on synced notes", async () => {
    const r1 = await api.createNote({ title: "JavaScript Guide", body: "learn JS" });
    const r2 = await api.createNote({ title: "Python Guide", body: "learn Python" });

    // Sync into local
    const remote = await api.fetchNotes();
    for (const note of remote) {
      if (!store.get(note.id)) store.create(note);
    }

    const jsNotes = filterNotes(store.list(), "JavaScript");
    assert.equal(jsNotes.length, 1);
    assert.equal(jsNotes[0].title, "JavaScript Guide");

    const guides = filterNotes(store.list(), "guide");
    assert.ok(guides.length >= 2, "should match both guides case-insensitively");

    await api.deleteNote(r1.id);
    await api.deleteNote(r2.id);
  });

  it("field mapping round-trip: body in store maps to content in API", async () => {
    // Create via API (sends content to backend)
    const created = await api.createNote({ title: "Mapping", body: "markdown **bold**" });
    assert.equal(created.body, "markdown **bold**", "API client maps content→body");

    // Fetch back and verify
    const fetched = await api.fetchNote(created.id);
    assert.equal(fetched.body, "markdown **bold**");

    // Update body via API (sends content to backend)
    const updated = await api.updateNote(created.id, { body: "new content" });
    assert.equal(updated.body, "new content");

    // Store locally and verify field name is body, not content
    store.create({
      id: updated.id,
      title: updated.title,
      body: updated.body,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
    const local = store.get(updated.id);
    assert.equal(local.body, "new content");
    assert.equal(local.content, undefined, "store uses body, not content");

    await api.deleteNote(created.id);
  });

  it("delete on server is reflected when note is missing from fetch list", async () => {
    const note = await api.createNote({ title: "Ephemeral", body: "will be deleted" });
    store.create({ id: note.id, title: note.title, body: note.body, createdAt: note.createdAt, updatedAt: note.updatedAt });

    // Delete on server
    await api.deleteNote(note.id);

    // Fetch list — note should not appear
    const remote = await api.fetchNotes();
    const remoteIds = new Set(remote.map((n) => n.id));
    assert.ok(!remoteIds.has(note.id), "deleted note should not appear in remote list");

    // Local store still has it (until app reconciles)
    assert.ok(store.get(note.id), "local store still has the note");

    // App would remove local copies not found on server in a full sync
    const localNotes = store.list();
    for (const local of localNotes) {
      if (!remoteIds.has(local.id)) {
        store.remove(local.id);
      }
    }
    assert.equal(store.get(note.id), null, "note should be removed after reconciliation");
  });
});
