import test from "node:test";
import assert from "node:assert/strict";
import { createNotesStore, createPrefsStore, createMemoryStorage, filterNotes } from "../src/notes-store.js";

test("creates, lists, updates, and deletes notes", () => {
  const store = createNotesStore(createMemoryStorage());
  const a = store.create({ title: "A", body: "alpha" });
  const b = store.create({ title: "B", body: "beta" });

  const all = store.list();
  assert.equal(all.length, 2);
  assert.equal(all[0].id, b.id);

  const updated = store.update(a.id, { body: "alpha-updated" });
  assert.equal(updated.body, "alpha-updated");
  assert.ok(updated.updatedAt >= a.updatedAt);

  assert.equal(store.remove(a.id), true);
  assert.equal(store.list().length, 1);
});

test("persists notes through the provided storage adapter", () => {
  const storage = createMemoryStorage();
  const first = createNotesStore(storage);
  const note = first.create({ title: "persist", body: "me" });

  const reopened = createNotesStore(storage);
  const found = reopened.get(note.id);
  assert.equal(found.title, "persist");
  assert.equal(found.body, "me");
});

test("ignores malformed persisted data", () => {
  const storage = createMemoryStorage();
  storage.setItem("inkwell/notes/v1", "not json");
  const store = createNotesStore(storage);
  assert.deepEqual(store.list(), []);
});

test("filterNotes matches title and body case-insensitively", () => {
  const notes = [
    { id: "1", title: "Coffee", body: "rich roast", updatedAt: 3, createdAt: 1 },
    { id: "2", title: "Tea", body: "has COFFEE-adjacent notes", updatedAt: 2, createdAt: 1 },
    { id: "3", title: "Water", body: "plain", updatedAt: 1, createdAt: 1 },
  ];
  const matches = filterNotes(notes, "coffee");
  assert.deepEqual(matches.map((n) => n.id), ["1", "2"]);
  assert.equal(filterNotes(notes, "").length, 3);
});

test("prefs store roundtrips values", () => {
  const storage = createMemoryStorage();
  const prefs = createPrefsStore(storage);
  prefs.set("lastOpenId", "abc");
  assert.equal(prefs.get("lastOpenId", null), "abc");
  assert.equal(prefs.get("missing", "fallback"), "fallback");

  const reopened = createPrefsStore(storage);
  assert.equal(reopened.get("lastOpenId", null), "abc");
});
