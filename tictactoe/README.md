# Tic-Tac-Toe

A two-player 3x3 tic-tac-toe game for the browser. Vanilla HTML, CSS, and
JavaScript — no build step, no framework.

## Running it

```sh
npm run serve
# open http://localhost:5174/
```

Any static file server works; the `serve` script just uses Python's built-in
one.

## Playing

- Click or tap a cell to place the current player's mark.
- Arrow keys navigate between cells (focus wraps at the edges).
- Enter or Space places on the focused cell.
- **R** starts a new round.
- The "Reset score" button clears the running tally.

## Layout

```
tictactoe/
├── index.html      # semantic shell + ARIA grid
├── src/
│   ├── app.js      # DOM wiring + localStorage
│   ├── game.js     # pure rules: applyMove / evaluate / nextPlayer
│   ├── sound.js    # Web Audio cue for move / win / draw
│   └── styles.css  # custom-property-driven theme, dark mode, responsive
└── test/
    ├── game.test.js
    └── sound.test.js
```

The rules live in `src/game.js` as pure functions, so they are testable with
plain `node --test` and never touch the DOM.

## Tests

```sh
npm test            # 17 tests covering game rules and sound cues
```

## Troubleshooting

- **No sound on first click** — browsers require a user gesture before playing audio. The first tap unlocks the AudioContext; sounds play from the second move onward.
- **Scores reset** — scores are stored in `localStorage`, which is per-origin. Changing the port or clearing browser data resets them.
