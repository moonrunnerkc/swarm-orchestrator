// Fetch-based client for the notes-api backend. Maps between the frontend
// note shape (body) and the API shape (content). Falls back gracefully so
// the app can still work with localStorage when the API is unreachable.

const API_BASE = "/api/notes";

const headers = { "Content-Type": "application/json" };

const toLocal = (remote) => ({
  id: remote.id,
  title: remote.title,
  body: remote.content ?? "",
  createdAt: new Date(remote.createdAt).getTime(),
  updatedAt: new Date(remote.updatedAt).getTime(),
});

const toRemoteCreate = (note) => ({
  title: note.title || "Untitled",
  content: note.body ?? "",
});

const toRemoteUpdate = (patch) => {
  const out = {};
  if ("title" in patch) out.title = patch.title || "Untitled";
  if ("body" in patch) out.content = patch.body;
  return out;
};

const request = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error?.message || `API error ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
};

export const fetchNotes = async () => {
  const data = await request(API_BASE);
  return data.items.map(toLocal);
};

export const fetchNote = async (id) => {
  const data = await request(`${API_BASE}/${id}`);
  return toLocal(data);
};

export const createNote = async (note = {}) => {
  const data = await request(API_BASE, {
    method: "POST",
    body: JSON.stringify(toRemoteCreate(note)),
  });
  return toLocal(data);
};

export const updateNote = async (id, patch) => {
  const data = await request(`${API_BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(toRemoteUpdate(patch)),
  });
  return toLocal(data);
};

export const deleteNote = async (id) => {
  await request(`${API_BASE}/${id}`, { method: "DELETE" });
};
