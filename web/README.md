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

No install required. Serve the directory with any static file server:

```bash
python3 -m http.server 5173
# or
npm run serve
```

Then open <http://localhost:5173/> in a browser.

## Tests

Pure logic (markdown parsing, stats, notes store) is covered by the Node
built-in test runner:

```bash
npm test
```

## Layout

- `index.html` — markup and metadata.
- `src/styles.css` — theme tokens on `:root`, light/dark variants, responsive
  layout.
- `src/markdown.js` — pure renderer and stats helpers.
- `src/notes-store.js` — notes CRUD and preferences, with an injectable
  storage adapter for testing.
- `src/audio-cue.js` — Web Audio beep for background-tab autosave feedback.
- `src/app.js` — thin glue between DOM events and the pure modules.

## Tests

```sh
npm test            # 20 tests covering markdown rendering, stats, and note store
```

## Troubleshooting

- **Styles not loading** — open `index.html` via a local server (`npm run serve`), not as a `file://` URL. Some browsers block module scripts from the filesystem.
- **Notes disappear** — notes are stored in `localStorage`, which is per-origin. Switching ports or domains starts a fresh store.
