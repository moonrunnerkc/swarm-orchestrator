// Unit tests for the bounded history store (src/history.js): storage-adapter
// injection, size capping, whitespace trimming, corrupt/malformed JSON
// recovery, entry-shape validation, and persistence across re-instantiation.

import test from "node:test";
import assert from "node:assert/strict";

import { createHistoryStore, createMemoryStorage } from "../src/history.js";

const fakeClock = (start = 1_700_000_000_000) => {
  let t = start;
  return () => ++t;
};

test("an empty store starts with an empty list", () => {
  const store = createHistoryStore(createMemoryStorage());
  assert.deepEqual(store.list(), []);
  assert.equal(store.size, 0);
});

test("add prepends entries with monotonic ids and timestamps", () => {
  const store = createHistoryStore(createMemoryStorage(), { now: fakeClock() });
  const a = store.add({ expression: "1 + 1", result: "2" });
  const b = store.add({ expression: "2 * 3", result: "6" });
  const list = store.list();
  assert.equal(list[0].id, b.id);
  assert.equal(list[1].id, a.id);
  assert.ok(b.at > a.at);
});

test("add trims whitespace and rejects empty fields with a specific message", () => {
  const store = createHistoryStore(createMemoryStorage());
  const entry = store.add({ expression: "  4 + 4  ", result: "  8  " });
  assert.equal(entry.expression, "4 + 4");
  assert.equal(entry.result, "8");
  assert.throws(() => store.add({ expression: "", result: "1" }), /non-empty/);
  assert.throws(() => store.add({ expression: "1", result: " " }), /non-empty/);
});

test("history is capped at the configured limit, oldest dropped first", () => {
  const store = createHistoryStore(createMemoryStorage(), { limit: 3 });
  for (let i = 0; i < 5; i++) store.add({ expression: `${i}+0`, result: String(i) });
  const list = store.list();
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((e) => e.result), ["4", "3", "2"]);
});

test("clear empties the store and persists the empty state", () => {
  const storage = createMemoryStorage();
  const store = createHistoryStore(storage);
  store.add({ expression: "1+1", result: "2" });
  store.clear();
  assert.equal(store.size, 0);
  const fresh = createHistoryStore(storage);
  assert.deepEqual(fresh.list(), []);
});

test("remove deletes a single entry by id", () => {
  const store = createHistoryStore(createMemoryStorage());
  const a = store.add({ expression: "1+1", result: "2" });
  store.add({ expression: "2+2", result: "4" });
  assert.equal(store.remove(a.id), true);
  assert.equal(store.size, 1);
  assert.equal(store.remove("nope"), false);
});

test("entries persist through the storage adapter and reload on init", () => {
  const storage = createMemoryStorage();
  const a = createHistoryStore(storage);
  a.add({ expression: "9+1", result: "10" });
  const b = createHistoryStore(storage);
  assert.equal(b.size, 1);
  assert.equal(b.list()[0].result, "10");
});

test("malformed JSON in storage is treated as an empty history", () => {
  const storage = createMemoryStorage();
  storage.setItem("calc/history/v1", "{not json");
  const store = createHistoryStore(storage);
  assert.deepEqual(store.list(), []);
});

test("entries with the wrong shape are filtered out on load", () => {
  const storage = createMemoryStorage();
  storage.setItem(
    "calc/history/v1",
    JSON.stringify([
      { id: "ok", expression: "1+1", result: "2", at: 1 },
      { id: 5, expression: "x", result: "x", at: 1 },
      { nope: true },
    ]),
  );
  const store = createHistoryStore(storage);
  assert.equal(store.size, 1);
  assert.equal(store.list()[0].id, "ok");
});

test("constructor rejects bad limits and missing storage", () => {
  assert.throws(() => createHistoryStore(null), /storage adapter/);
  assert.throws(() => createHistoryStore(createMemoryStorage(), { limit: 0 }), /positive integer/);
  assert.throws(() => createHistoryStore(createMemoryStorage(), { limit: 1.5 }), /positive integer/);
});

test("get returns the entry by id or null when absent", () => {
  const store = createHistoryStore(createMemoryStorage());
  const e = store.add({ expression: "7-1", result: "6" });
  assert.equal(store.get(e.id).result, "6");
  assert.equal(store.get("missing"), null);
});
