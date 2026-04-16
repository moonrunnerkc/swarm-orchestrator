// JSON-file-backed repository for Calculation records.
// Writes are serialized through a promise chain so concurrent requests can't
// clobber each other, and the file is replaced atomically via rename-over.

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 1;

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, items: [] };
}

export function createStore({ dataFile, now = () => new Date().toISOString() }) {
  if (!dataFile) throw new Error("createStore: dataFile is required");

  let writeChain = Promise.resolve();

  async function read() {
    try {
      const raw = await fs.readFile(dataFile, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error(
          `data file ${dataFile} is malformed: missing "items" array`,
        );
      }
      return parsed;
    } catch (err) {
      if (err.code === "ENOENT") return emptyState();
      throw err;
    }
  }

  async function writeAtomic(state) {
    const dir = path.dirname(dataFile);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, dataFile);
  }

  function enqueue(mutator) {
    const next = writeChain.then(async () => {
      const state = await read();
      const result = await mutator(state);
      await writeAtomic(state);
      return result;
    });
    writeChain = next.catch(() => {});
    return next;
  }

  return {
    async list() {
      const state = await read();
      return state.items.slice();
    },

    async get(id) {
      const state = await read();
      return state.items.find((item) => item.id === id) ?? null;
    },

    async create({ title, expression, result }) {
      return enqueue(async (state) => {
        const timestamp = now();
        const record = {
          id: randomUUID(),
          title: title ?? null,
          expression,
          result,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        state.items.push(record);
        return record;
      });
    },

    async update(id, patch) {
      return enqueue(async (state) => {
        const idx = state.items.findIndex((item) => item.id === id);
        if (idx === -1) return null;
        const current = state.items[idx];
        const updated = {
          ...current,
          ...patch,
          id: current.id,
          createdAt: current.createdAt,
          updatedAt: now(),
        };
        state.items[idx] = updated;
        return updated;
      });
    },

    async remove(id) {
      return enqueue(async (state) => {
        const idx = state.items.findIndex((item) => item.id === id);
        if (idx === -1) return false;
        state.items.splice(idx, 1);
        return true;
      });
    },

    async clear() {
      return enqueue(async (state) => {
        state.items.length = 0;
        return true;
      });
    },
  };
}
