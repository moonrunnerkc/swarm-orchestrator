# Calculator

A pure-JavaScript calculator core: a four-function engine with chained
operations, a `KeyboardEvent.key` → action map, and a bounded history store
with pluggable storage. No DOM, no framework, no build step. The modules are
the kind of thing you wire into a UI — there is no UI in this package.

## Modules

```
calculator/
├── src/
│   ├── calculator.js   # pure state machine: digits, operators, chaining, evaluate
│   ├── history.js      # bounded history store; storage adapter is injected
│   └── keymap.js       # KeyboardEvent.key → calculator action
└── test/
    ├── calculator.test.js
    ├── history.test.js
    ├── keymap.test.js
    ├── integration.test.js    # keymap → engine → history, end-to-end
    └── edge-cases.test.js
```

Every engine transition takes a state and returns a new frozen state, so the
host can render from snapshots and the tests can drive the engine directly.
`history.js` reads and writes through an injected adapter — `localStorage` in
a browser, `createMemoryStorage()` in tests.

## Behaviour

- **0–9** type digits (capped at 16). **.** or **,** types a decimal point.
- **+ − \* /** queue an operation; two operators in a row swap the pending
  one. **Enter** / **=** evaluates; pressing `=` again repeats the last
  operator/operand pair against the current result.
- **Backspace** deletes one digit. **Delete** clears the current entry.
  **Escape** clears everything.
- **%** divides the entry by 100. **\_** flips the sign.
- History keeps the most recent 50 calculations (configurable via `limit`).
- Division by zero and non-finite results raise a sticky error state that
  only `clearAll` / `clearEntry` resets.

## Tests

No runtime dependencies; the suite uses Node's built-in test runner.

```sh
npm install   # no-op, but standard
npm test      # 83 tests, ~120 ms
npm run coverage
```

Coverage is ~99% lines / 97% branches across the three modules. The single
uncovered branch (`calculator.js:133–134`) is a defensive re-raise for a
state the public API cannot construct — see `test/TEST_REPORT.md`.

## Wiring example

```js
import {
  backspace, clearAll, clearEntry, evaluate, initialState,
  inputDecimal, inputDigit, inputOperator, negate, percent,
} from "./src/calculator.js";
import { createHistoryStore } from "./src/history.js";
import { ACTIONS, keyToAction } from "./src/keymap.js";

const history = createHistoryStore(window.localStorage);
let state = initialState();

function onKey(key) {
  const action = keyToAction(key);
  if (!action) return;
  switch (action.type) {
    case ACTIONS.DIGIT:       state = inputDigit(state, action.value); break;
    case ACTIONS.DECIMAL:     state = inputDecimal(state); break;
    case ACTIONS.OPERATOR:    state = inputOperator(state, action.value); break;
    case ACTIONS.EQUALS: {
      const r = evaluate(state);
      state = r.state;
      if (r.entry) history.add(r.entry);
      break;
    }
    case ACTIONS.CLEAR_ALL:   state = clearAll(); break;
    case ACTIONS.CLEAR_ENTRY: state = clearEntry(state); break;
    case ACTIONS.BACKSPACE:   state = backspace(state); break;
    case ACTIONS.NEGATE:      state = negate(state); break;
    case ACTIONS.PERCENT:     state = percent(state); break;
  }
  render(state, history.list());
}
```

`test/integration.test.js` exercises exactly this shape end-to-end.

## Troubleshooting

- **`npm test` fails with "unknown option --test"** — the suite uses the
  built-in Node test runner, which requires **Node ≥ 18**. Older versions
  don't ship it.
- **`0.1 + 0.2` shows `0.3`, not `0.30000000000000004`** — intentional.
  `formatNumber` rounds to 12 significant digits to strip binary
  floating-point noise.
- **History doesn't persist across page loads** — you didn't pass a
  persistent storage adapter. `createHistoryStore()` takes any
  `{ getItem, setItem }` pair; hand it `window.localStorage` in the browser.
- **Entering a 17th digit appears to do nothing** — also intentional. The
  engine caps displayed digits at 16 to keep `Number`-backed arithmetic
  within safe precision.
