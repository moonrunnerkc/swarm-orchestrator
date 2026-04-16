// Advanced store tests covering:
// - clear() method empties persisted data
// - Atomic write behavior (data survives across instances)
// - Error propagation from store through routes
// - Store with missing dataFile argument

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

describe("store.clear()", () => {
  let tmpDir;
  let store;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-store-adv-"));
    store = createStore({ dataFile: path.join(tmpDir, "data.json") });
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("removes all items and persists empty state", async () => {
    await store.create({ title: "Note 1", content: "a" });
    await store.create({ title: "Note 2", content: "b" });

    let items = await store.list();
    assert.equal(items.length, 2);

    const result = await store.clear();
    assert.equal(result, true);

    items = await store.list();
    assert.equal(items.length, 0);
  });

  it("clear persists across store instances", async () => {
    const dataFile = path.join(tmpDir, "data.json");
    const store1 = createStore({ dataFile });
    await store1.create({ title: "persist test", content: "" });
    await store1.clear();

    const store2 = createStore({ dataFile });
    const items = await store2.list();
    assert.equal(items.length, 0);
  });
});

describe("store error handling", () => {
  it("throws when dataFile is not provided", () => {
    assert.throws(
      () => createStore({}),
      (err) => err.message.includes("dataFile is required"),
    );
  });

  it("returns empty list when data directory does not exist yet", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-store-nodir-"));
    const store = createStore({
      dataFile: path.join(tmpDir, "sub", "deep", "data.json"),
    });
    const items = await store.list();
    assert.equal(items.length, 0);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates data directory on first write", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-store-mkdir-"));
    const nestedPath = path.join(tmpDir, "sub", "deep", "data.json");
    const store = createStore({ dataFile: nestedPath });
    await store.create({ title: "auto-dir test", content: "" });

    const items = await store.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "auto-dir test");
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
