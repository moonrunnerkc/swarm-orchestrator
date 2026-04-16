// Bounded, immutable history of past calculations. Newest entry first. The
// underlying storage adapter is injected so the same store works against
// localStorage in the browser and an in-memory map in tests.

const STORAGE_KEY = "calc/history/v1";
const DEFAULT_LIMIT = 50;

export function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

export function createHistoryStore(storage, { limit = DEFAULT_LIMIT, now = Date.now } = {}) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new TypeError("createHistoryStore requires a storage adapter with getItem/setItem");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`history limit must be a positive integer, got ${limit}`);
  }

  let entries = read();

  function read() {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidEntry).slice(0, limit);
    } catch {
      return [];
    }
  }

  function persist() {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function list() {
    return entries.slice();
  }

  function add({ expression, result }) {
    const trimmedExpr = typeof expression === "string" ? expression.trim() : "";
    const trimmedResult = typeof result === "string" ? result.trim() : "";
    if (!trimmedExpr || !trimmedResult) {
      throw new TypeError(`history entry needs non-empty expression and result, got ${JSON.stringify({ expression, result })}`);
    }
    const entry = {
      id: makeId(),
      expression: trimmedExpr,
      result: trimmedResult,
      at: now(),
    };
    entries = [entry, ...entries].slice(0, limit);
    persist();
    return entry;
  }

  function clear() {
    if (entries.length === 0) return;
    entries = [];
    persist();
  }

  function remove(id) {
    const before = entries.length;
    entries = entries.filter((e) => e.id !== id);
    if (entries.length !== before) persist();
    return entries.length !== before;
  }

  function get(id) {
    return entries.find((e) => e.id === id) ?? null;
  }

  return { list, add, clear, remove, get, get size() { return entries.length; } };
}

function isValidEntry(e) {
  return (
    e &&
    typeof e.id === "string" &&
    typeof e.expression === "string" &&
    typeof e.result === "string" &&
    Number.isFinite(e.at)
  );
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ??
    `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
