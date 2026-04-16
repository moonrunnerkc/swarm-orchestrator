// Pure state container for notes. Reads/writes pass through an injected
// storage adapter so the logic is fully testable without localStorage.

const STORAGE_KEY = "inkwell/notes/v1";
const PREFS_KEY = "inkwell/prefs/v1";

export const createMemoryStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
};

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);

const blankNote = (id = newId(), now = Date.now()) => ({
  id,
  title: "",
  body: "",
  createdAt: now,
  updatedAt: now,
});

export const createNotesStore = (storage) => {
  const read = () => {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidNote);
    } catch {
      return [];
    }
  };

  const write = (notes) => {
    storage.setItem(STORAGE_KEY, JSON.stringify(notes));
  };

  let notes = read();

  const byUpdated = (a, b) => b.updatedAt - a.updatedAt;

  const list = () => [...notes].sort(byUpdated);

  const get = (id) => notes.find((n) => n.id === id) ?? null;

  const create = (seed = {}) => {
    const note = { ...blankNote(), ...seed };
    notes = [note, ...notes];
    write(notes);
    return note;
  };

  const update = (id, patch) => {
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    const next = { ...notes[idx], ...patch, updatedAt: Date.now() };
    notes = [...notes.slice(0, idx), next, ...notes.slice(idx + 1)];
    write(notes);
    return next;
  };

  const remove = (id) => {
    const before = notes.length;
    notes = notes.filter((n) => n.id !== id);
    if (notes.length !== before) write(notes);
    return before !== notes.length;
  };

  return { list, get, create, update, remove };
};

const isValidNote = (n) =>
  n &&
  typeof n.id === "string" &&
  typeof n.title === "string" &&
  typeof n.body === "string" &&
  Number.isFinite(n.createdAt) &&
  Number.isFinite(n.updatedAt);

export const createPrefsStore = (storage) => {
  const read = () => {
    try {
      return JSON.parse(storage.getItem(PREFS_KEY) || "{}") || {};
    } catch {
      return {};
    }
  };
  const write = (p) => storage.setItem(PREFS_KEY, JSON.stringify(p));
  let prefs = read();
  return {
    get: (key, fallback) => (key in prefs ? prefs[key] : fallback),
    set: (key, value) => {
      prefs = { ...prefs, [key]: value };
      write(prefs);
    },
  };
};

// Case-insensitive substring match over title and body. Returns list sorted
// by recency, matching the default view.
export const filterNotes = (notes, query) => {
  const q = (query || "").trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
};
