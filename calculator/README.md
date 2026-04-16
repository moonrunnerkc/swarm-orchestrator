# Calculator

A four-function calculator for the browser with chained operations, full
keyboard control, and a persistent history panel. Vanilla HTML, CSS, and
JavaScript — no build step, no framework.

## Running it

```sh
npm run serve
# open http://localhost:5175/
```

Any static file server works; the `serve` script just uses Python's built-in
one.

## Using it

- Click a key or use the keyboard.
- **0–9** type digits. **.** or **,** types a decimal point.
- **+ − \* /** queue an operation. Pressing two operators in a row swaps
  which one is pending.
- **Enter** or **=** evaluates. Pressing `=` again repeats the last
  operation against the current result.
- **Backspace** deletes one digit. **Delete** clears the current entry.
  **Escape** clears everything.
- **%** divides the current entry by 100. **\_** flips the sign.
- The history panel keeps the last 50 calculations; click one to recall its
  result, or use the clear button to wipe the panel.

## Layout

```
calculator/
├── src/
│   ├── calculator.js   # pure engine: digits, operators, chaining, evaluate
│   ├── history.js      # bounded history store with pluggable storage
│   └── keymap.js       # KeyboardEvent.key → calculator action
└── test/
    ├── calculator.test.js
    ├── history.test.js
    └── keymap.test.js
```

The engine in `src/calculator.js` is a set of pure transitions: every action
takes a state and returns a new frozen state. Nothing in `src/` touches the
DOM or `localStorage` directly — `history.js` reads and writes through an
injected adapter so the same module powers the browser and the tests.

## Tests

```sh
npm test
```
