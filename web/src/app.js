// Glue module: turns user events into store mutations and re-renders the DOM.
// Uses the backend API as primary data source with localStorage as offline cache.

import { renderMarkdown, computeStats, deriveTitle } from "./markdown.js";
import { createNotesStore, createPrefsStore, filterNotes } from "./notes-store.js";
import { beep } from "./audio-cue.js";
import * as api from "./api.js";

const SAVE_DEBOUNCE_MS = 350;
const BACKGROUND_BEEP_EVERY_MS = 8000;
const TOAST_DURATION_MS = 4000;

const $ = (id) => document.getElementById(id);

const formatTimestamp = (ms) => {
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const main = () => {
  const notesStore = createNotesStore(window.localStorage);
  const prefs = createPrefsStore(window.localStorage);

  const els = {
    list: $("note-list"),
    empty: $("empty-state"),
    search: $("search"),
    title: $("title"),
    editor: $("editor"),
    preview: $("preview"),
    wordcount: $("wordcount"),
    charcount: $("charcount"),
    readtime: $("readtime"),
    savestate: $("savestate"),
    newNote: $("new-note"),
    togglePreview: $("toggle-preview"),
    toggleSidebar: $("toggle-sidebar"),
    statusline: $("statusline"),
    toast: $("toast"),
    layout: document.querySelector(".layout"),
    workspace: document.querySelector(".workspace"),
  };

  let activeId = prefs.get("lastOpenId", null);
  let query = "";
  let saveTimer = null;
  let lastBeepAt = 0;
  let toastTimer = null;
  let syncing = false;

  const showToast = (message, variant = "error") => {
    if (toastTimer) clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.dataset.variant = variant;
    els.toast.hidden = false;
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, TOAST_DURATION_MS);
  };

  const ensureActiveNote = () => {
    const existing = activeId ? notesStore.get(activeId) : null;
    if (existing) return existing;
    const any = notesStore.list()[0];
    if (any) {
      activeId = any.id;
      prefs.set("lastOpenId", activeId);
      return any;
    }
    const fresh = notesStore.create();
    activeId = fresh.id;
    prefs.set("lastOpenId", activeId);
    return fresh;
  };

  const renderSidebar = () => {
    const all = notesStore.list();
    const filtered = filterNotes(all, query);
    els.empty.hidden = all.length !== 0;

    els.list.replaceChildren(
      ...filtered.map((note) => {
        const li = document.createElement("li");
        li.className = "note-item";
        li.dataset.id = note.id;
        if (note.id === activeId) li.setAttribute("aria-current", "true");

        const open = document.createElement("button");
        open.type = "button";
        open.className = "note-item__main";
        open.setAttribute("aria-label", `Open note: ${note.title || "Untitled"}`);
        open.innerHTML = `
          <span class="note-item__title"></span>
          <span class="note-item__meta"></span>
        `;
        open.querySelector(".note-item__title").textContent = note.title || "Untitled";
        open.querySelector(".note-item__meta").textContent =
          `${formatTimestamp(note.updatedAt)} · ${computeStats(note.body).words} words`;
        open.addEventListener("click", () => selectNote(note.id));

        const del = document.createElement("button");
        del.type = "button";
        del.className = "note-item__delete";
        del.setAttribute("aria-label", `Delete note: ${note.title || "Untitled"}`);
        del.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>`;
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          confirmDelete(note);
        });

        li.append(open, del);
        return li;
      })
    );
  };

  const renderEditorFor = (note) => {
    els.title.value = note.title;
    els.editor.value = note.body;
    renderPreview(note.body);
    updateStats(note.body);
    setSaveState("saved");
  };

  const renderPreview = (body) => {
    els.preview.innerHTML = renderMarkdown(body);
  };

  const updateStats = (body) => {
    const { words, characters, readMinutes } = computeStats(body);
    els.wordcount.textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
    els.charcount.textContent = `${characters.toLocaleString()} ${characters === 1 ? "character" : "characters"}`;
    els.readtime.textContent = `${readMinutes < 1 ? "<1" : readMinutes} min read`;
  };

  const setSaveState = (state) => {
    els.savestate.dataset.state = state;
    els.savestate.textContent = state === "dirty" ? "Saving…" : "Saved";
  };

  const scheduleSave = () => {
    setSaveState("dirty");
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(commitEdit, SAVE_DEBOUNCE_MS);
  };

  const commitEdit = async () => {
    const body = els.editor.value;
    const explicit = els.title.value.trim();
    const title = explicit || deriveTitle(body);
    const updated = notesStore.update(activeId, { title, body });
    if (!updated) return;
    setSaveState("saved");
    renderSidebar();

    try {
      await api.updateNote(activeId, { title, body });
    } catch {
      showToast("Saved locally — sync will retry when the server is reachable.");
    }

    if (document.hidden && Date.now() - lastBeepAt > BACKGROUND_BEEP_EVERY_MS) {
      lastBeepAt = Date.now();
      beep({ frequency: 540, duration: 0.06, volume: 0.03 });
    }
    els.statusline.textContent = `Saved at ${new Date(updated.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  };

  const selectNote = (id) => {
    const note = notesStore.get(id);
    if (!note) return;
    activeId = id;
    prefs.set("lastOpenId", id);
    renderSidebar();
    renderEditorFor(note);
    els.editor.focus({ preventScroll: true });
    if (els.layout.dataset.sidebar === "open" && window.matchMedia("(max-width: 640px)").matches) {
      els.layout.dataset.sidebar = "closed";
      els.toggleSidebar.setAttribute("aria-expanded", "false");
    }
  };

  const confirmDelete = async (note) => {
    const label = note.title || "Untitled";
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    const wasActive = note.id === activeId;

    const deleteBtn = els.list.querySelector(`[data-id="${note.id}"] .note-item__delete`);
    if (deleteBtn) deleteBtn.disabled = true;

    notesStore.remove(note.id);

    try {
      await api.deleteNote(note.id);
    } catch {
      showToast("Deleted locally — server sync pending.");
    }

    if (wasActive) {
      const fallback = notesStore.list()[0];
      if (fallback) {
        selectNote(fallback.id);
        return;
      }
      const fresh = await createNoteViaApi();
      activeId = fresh.id;
      prefs.set("lastOpenId", activeId);
      renderEditorFor(fresh);
    }
    renderSidebar();
  };

  const createNoteViaApi = async (seed = {}) => {
    let note;
    try {
      note = await api.createNote(seed);
      notesStore.create({ ...seed, id: note.id, createdAt: note.createdAt, updatedAt: note.updatedAt });
    } catch {
      note = notesStore.create(seed);
      showToast("Created offline — will sync when server is available.");
    }
    return notesStore.get(note.id) || note;
  };

  const createNote = async () => {
    els.newNote.disabled = true;
    els.newNote.setAttribute("aria-busy", "true");
    try {
      const note = await createNoteViaApi();
      activeId = note.id;
      prefs.set("lastOpenId", note.id);
      renderSidebar();
      renderEditorFor(note);
      els.title.focus();
    } finally {
      els.newNote.disabled = false;
      els.newNote.removeAttribute("aria-busy");
    }
  };

  const togglePreview = () => {
    const next = els.workspace.dataset.preview === "hidden" ? "shown" : "hidden";
    els.workspace.dataset.preview = next;
    els.togglePreview.setAttribute("aria-pressed", next === "shown" ? "true" : "false");
    prefs.set("previewHidden", next === "hidden");
  };

  const toggleSidebar = () => {
    const next = els.layout.dataset.sidebar === "closed" ? "open" : "closed";
    els.layout.dataset.sidebar = next;
    els.toggleSidebar.setAttribute("aria-expanded", next === "open" ? "true" : "false");
    prefs.set("sidebarClosed", next === "closed");
  };

  const syncFromServer = async () => {
    if (syncing) return;
    syncing = true;
    els.statusline.textContent = "Syncing…";
    try {
      const remote = await api.fetchNotes();
      for (const note of remote) {
        const local = notesStore.get(note.id);
        if (!local) {
          notesStore.create(note);
        } else if (note.updatedAt > local.updatedAt) {
          notesStore.update(note.id, note);
        }
      }
      els.statusline.textContent = "Synced";
      renderSidebar();
      if (activeId) {
        const current = notesStore.get(activeId);
        if (current) renderEditorFor(current);
      }
    } catch {
      els.statusline.textContent = "Offline — using local data";
    } finally {
      syncing = false;
    }
  };

  // ----- bindings -----
  els.editor.addEventListener("input", () => {
    renderPreview(els.editor.value);
    updateStats(els.editor.value);
    scheduleSave();
  });

  els.title.addEventListener("input", scheduleSave);

  els.editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart, selectionEnd, value } = els.editor;
      els.editor.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      els.editor.selectionStart = els.editor.selectionEnd = selectionStart + 2;
      renderPreview(els.editor.value);
      updateStats(els.editor.value);
      scheduleSave();
    }
  });

  els.search.addEventListener("input", () => {
    query = els.search.value;
    renderSidebar();
  });

  els.newNote.addEventListener("click", createNote);
  els.togglePreview.addEventListener("click", togglePreview);
  els.toggleSidebar.addEventListener("click", toggleSidebar);

  document.addEventListener("keydown", (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "s") {
      e.preventDefault();
      commitEdit();
    } else if (meta && e.altKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      createNote();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      commitEdit();
    }
  });

  // ----- initial render -----
  if (prefs.get("previewHidden", false)) togglePreview();
  if (prefs.get("sidebarClosed", false)) toggleSidebar();
  const current = ensureActiveNote();
  renderSidebar();
  renderEditorFor(current);
  syncFromServer();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
