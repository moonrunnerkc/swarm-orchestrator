// Unit tests for web/src/api.js — the fetch-based client that maps between
// frontend note shape (body) and backend API shape (content). Uses a stubbed
// global fetch so no real server is needed.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// --- stub helpers ---

let fetchCalls = [];
let fetchResponse;

function stubFetch(status, body, { json = true } = {}) {
  fetchResponse = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    return fetchResponse;
  };
}

// --- dynamic import each test suite to pick up the stub ---
// We use a fresh import via query-string cache-busting.

let counter = 0;
async function loadApi() {
  counter++;
  // Force a fresh module evaluation each time so the stub is visible.
  const mod = await import(`../src/api.js?v=${counter}`);
  return mod;
}

describe("api client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- fetchNotes ---

  describe("fetchNotes", () => {
    it("returns notes with body mapped from content", async () => {
      stubFetch(200, {
        items: [
          { id: "a1", title: "First", content: "hello", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
          { id: "b2", title: "Second", content: "", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
        ],
      });
      const api = await loadApi();
      const notes = await api.fetchNotes();

      assert.equal(notes.length, 2);
      assert.equal(notes[0].id, "a1");
      assert.equal(notes[0].title, "First");
      assert.equal(notes[0].body, "hello");
      assert.equal(typeof notes[0].createdAt, "number");
      assert.equal(typeof notes[0].updatedAt, "number");
      assert.equal(notes[1].body, "");
    });

    it("calls GET /api/notes", async () => {
      stubFetch(200, { items: [] });
      const api = await loadApi();
      await api.fetchNotes();

      assert.equal(fetchCalls.length, 1);
      assert.ok(fetchCalls[0].url.endsWith("/api/notes"));
    });
  });

  // --- fetchNote ---

  describe("fetchNote", () => {
    it("returns a single note with body mapped from content", async () => {
      stubFetch(200, { id: "x1", title: "Solo", content: "body text", createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z" });
      const api = await loadApi();
      const note = await api.fetchNote("x1");

      assert.equal(note.id, "x1");
      assert.equal(note.body, "body text");
      assert.ok(fetchCalls[0].url.endsWith("/api/notes/x1"));
    });
  });

  // --- createNote ---

  describe("createNote", () => {
    it("sends title and content (mapped from body) via POST", async () => {
      stubFetch(201, { id: "n1", title: "New", content: "stuff", createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" });
      const api = await loadApi();
      const note = await api.createNote({ title: "New", body: "stuff" });

      assert.equal(note.id, "n1");
      assert.equal(note.body, "stuff");

      const sent = JSON.parse(fetchCalls[0].opts.body);
      assert.equal(sent.title, "New");
      assert.equal(sent.content, "stuff");
      assert.equal(sent.body, undefined, "should send content not body to backend");
    });

    it("defaults title to Untitled when empty", async () => {
      stubFetch(201, { id: "n2", title: "Untitled", content: "", createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" });
      const api = await loadApi();
      await api.createNote({});

      const sent = JSON.parse(fetchCalls[0].opts.body);
      assert.equal(sent.title, "Untitled");
    });

    it("uses POST method", async () => {
      stubFetch(201, { id: "n3", title: "T", content: "", createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" });
      const api = await loadApi();
      await api.createNote({ title: "T" });

      assert.equal(fetchCalls[0].opts.method, "POST");
    });
  });

  // --- updateNote ---

  describe("updateNote", () => {
    it("sends content (mapped from body) via PUT", async () => {
      stubFetch(200, { id: "u1", title: "T", content: "updated", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" });
      const api = await loadApi();
      const note = await api.updateNote("u1", { body: "updated" });

      assert.equal(note.body, "updated");
      assert.equal(fetchCalls[0].opts.method, "PUT");

      const sent = JSON.parse(fetchCalls[0].opts.body);
      assert.equal(sent.content, "updated");
      assert.equal(sent.body, undefined, "should map body→content for backend");
    });

    it("sends title when included in patch", async () => {
      stubFetch(200, { id: "u2", title: "Renamed", content: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" });
      const api = await loadApi();
      await api.updateNote("u2", { title: "Renamed" });

      const sent = JSON.parse(fetchCalls[0].opts.body);
      assert.equal(sent.title, "Renamed");
    });

    it("defaults title to Untitled when empty string", async () => {
      stubFetch(200, { id: "u3", title: "Untitled", content: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" });
      const api = await loadApi();
      await api.updateNote("u3", { title: "" });

      const sent = JSON.parse(fetchCalls[0].opts.body);
      assert.equal(sent.title, "Untitled");
    });
  });

  // --- deleteNote ---

  describe("deleteNote", () => {
    it("sends DELETE request and returns nothing", async () => {
      stubFetch(204, null);
      const api = await loadApi();
      const result = await api.deleteNote("d1");

      assert.equal(result, undefined);
      assert.equal(fetchCalls[0].opts.method, "DELETE");
      assert.ok(fetchCalls[0].url.endsWith("/api/notes/d1"));
    });
  });

  // --- error handling ---

  describe("error handling", () => {
    it("throws on non-ok response with API error message", async () => {
      stubFetch(400, { error: { code: "VALIDATION_ERROR", message: "title is required" } });
      const api = await loadApi();

      await assert.rejects(() => api.createNote({}), (err) => {
        assert.match(err.message, /title is required/);
        return true;
      });
    });

    it("throws with status code when response has no error message", async () => {
      stubFetch(500, null);
      // Make json() reject to simulate non-JSON body
      fetchResponse.json = async () => { throw new Error("not json"); };
      const api = await loadApi();

      await assert.rejects(() => api.fetchNotes(), (err) => {
        assert.match(err.message, /500/);
        return true;
      });
    });
  });

  // --- field mapping edge cases ---

  describe("field mapping", () => {
    it("maps null content to empty string in toLocal", async () => {
      stubFetch(200, { id: "m1", title: "T", content: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
      const api = await loadApi();
      const note = await api.fetchNote("m1");

      assert.equal(note.body, "");
    });

    it("converts ISO date strings to epoch milliseconds", async () => {
      const iso = "2026-06-15T12:30:00Z";
      stubFetch(200, { id: "m2", title: "T", content: "", createdAt: iso, updatedAt: iso });
      const api = await loadApi();
      const note = await api.fetchNote("m2");

      assert.equal(note.createdAt, new Date(iso).getTime());
      assert.equal(note.updatedAt, new Date(iso).getTime());
    });
  });
});
