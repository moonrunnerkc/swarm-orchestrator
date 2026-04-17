# Inkwell

A browser-based markdown editor with live preview, a sidebar notebook, and
local persistence. No build step, no runtime dependencies.

## Features

- Split editor and preview with Markdown rendered as you type.
- Sidebar with create, search, open, rename, and delete (CRUD) for notes.
- Word count, character count, and estimated read time.
- Autosave to `localStorage`; the last open note and pane preferences survive
  reloads.
- Keyboard shortcuts: `Ctrl/Cmd+S` forces a save, `Ctrl/Cmd+Alt+N` creates a
  new note.
- Keyboard navigable, ARIA-labelled controls, and focus-visible styling.
- Honours `prefers-color-scheme` (dark mode) and `prefers-reduced-motion`.

## Running

No install required. For full functionality (editor + notes-api backend):

```bash
# Terminal 1 — start the notes API
cd ../notes-api && npm start

# Terminal 2 — start the dev server (serves static files + proxies /api to notes-api)
npm run dev
```

Then open <http://localhost:5173/> in a browser. The dev server proxies
`/api/notes` requests to the notes-api backend on port 3002.

For static-only mode (localStorage only, no backend sync):

```bash
npm run serve
```

## Layout

- `index.html` — markup and metadata.
- `src/styles.css` — theme tokens on `:root`, light/dark variants, responsive
  layout.
- `src/markdown.js` — pure renderer and stats helpers.
- `src/notes-store.js` — notes CRUD and preferences, with an injectable
  storage adapter for testing.
- `src/api.js` — fetch-based client for the notes-api backend, with
  `body`/`content` field mapping and graceful offline fallback.
- `src/audio-cue.js` — Web Audio beep for background-tab autosave feedback.
- `src/app.js` — thin glue between DOM events and the pure modules.
- `dev-server.js` — zero-dependency Node.js dev server with `/api` proxy.

## Tests

```sh
npm test            # 64 tests covering API client, markdown rendering, store, audio, proxy, and integration
```
