import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createStore } from "../src/store.js";

let tmpDir;
let dataFile;
let store;
let clock;

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-store-"));
  dataFile = path.join(tmpDir, "data.json");
  clock = 0;
  store = createStore({
    dataFile,
    now: () => `2026-01-01T00:00:0${clock++}Z`,
  });
}

async function teardown() {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

describe("store", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("returns empty list when data file does not exist", async () => {
    assert.deepStrictEqual(await store.list(), []);
  });

  it("creates and retrieves a record", async () => {
    const rec = await store.create({
      title: "My Note",
      content: "Hello world",
    });
    assert.strictEqual(rec.title, "My Note");
    assert.strictEqual(rec.content, "Hello world");
    assert.ok(rec.id);
    assert.ok(rec.createdAt);

    const got = await store.get(rec.id);
    assert.deepStrictEqual(got, rec);
  });

  it("persists data across store instances", async () => {
    await store.create({ title: "Persistent", content: "stays" });
    const store2 = createStore({ dataFile });
    const items = await store2.list();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].content, "stays");
  });

  it("updates a record", async () => {
    const rec = await store.create({ title: "v1", content: "original" });
    const updated = await store.update(rec.id, { title: "v2" });
    assert.strictEqual(updated.title, "v2");
    assert.strictEqual(updated.content, "original");
    assert.notStrictEqual(updated.updatedAt, rec.updatedAt);
    assert.strictEqual(updated.createdAt, rec.createdAt);
  });

  it("update returns null for missing id", async () => {
    const result = await store.update("00000000-0000-4000-a000-000000000000", {
      title: "nope",
    });
    assert.strictEqual(result, null);
  });

  it("removes a record", async () => {
    const rec = await store.create({ title: "Doomed", content: "bye" });
    assert.strictEqual(await store.remove(rec.id), true);
    assert.strictEqual(await store.get(rec.id), null);
  });

  it("remove returns false for missing id", async () => {
    assert.strictEqual(
      await store.remove("00000000-0000-4000-a000-000000000000"),
      false,
    );
  });

  it("handles concurrent writes without data loss", async () => {
    const writes = Array.from({ length: 10 }, (_, i) =>
      store.create({ title: `note-${i}`, content: `content-${i}` }),
    );
    await Promise.all(writes);
    const items = await store.list();
    assert.strictEqual(items.length, 10);
  });
});
