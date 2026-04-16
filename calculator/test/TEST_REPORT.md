# Calculator — Test Report (Step 2 / TesterElite)

Date: 2026-04-16
Branch: `swarm/swarm-2026-04-16T21-13-19-610Z/step-2-testerelite`
Package under test: `calculator/` (pure-client JS, no build step)

## Summary

| Metric           | Value                     |
| ---------------- | ------------------------- |
| Test files       | 5 (`calculator`, `history`, `keymap`, **`integration`**, **`edge-cases`**) |
| Tests            | **83**                    |
| Pass / fail      | 83 / 0                    |
| Duration         | ~120 ms                   |
| Runner           | `node --test` (built-in)  |

## Coverage (`node --experimental-test-coverage`)

| File                | Lines  | Branches | Funcs  |
| ------------------- | -----: | -------: | -----: |
| `src/calculator.js` | 99.15% |   95.88% | 100.0% |
| `src/history.js`    | 100.0% |   100.0% | 94.12% |
| `src/keymap.js`     | 100.0% |   100.0% | 100.0% |
| **all**             | **99.46%** | **97.39%** | **97.14%** |

Uncovered lines: `calculator.js:133-134` — the repeated-`=` branch that
re-raises a divide-by-zero error. The only way to reach it is for
`state.lastOperand` to be `0` with `state.lastOp === "/"`, but the engine
never successfully stores that pair (division-by-zero is caught and sets the
error before `lastOp`/`lastOperand` are written). The branch exists as a
defensive guard; documenting it as unreachable through the public API rather
than forcing a white-box test that pokes at internal state.

## What was added this step

1. **`test/integration.test.js`** (15 tests). A session harness wires
   `keyToAction` → calculator transitions → `historyStore.add` the way the
   browser UI will. Covers: full calculation, chained ops, repeated `=`,
   Unicode key aliases (`×`, `÷`), `Escape`/`Delete`/`Backspace`,
   percent/negate, decimal via dot **and** comma, division-by-zero, storage
   round-trip across two `createSession`s, 50-entry history cap across 60
   sequential calculations, `0.1 + 0.2 = 0.3` rounding, and `negate →
   evaluate → history entry` round-trip.

2. **`test/edge-cases.test.js`** (26 tests). Targets the branches the
   primary suite did not reach: chained-operator divide-by-zero, `=` with no
   prior operation, `=` on a bare number, 16-digit entry cap, error-state
   passthrough on `inputDecimal`/`negate`/`percent`/`backspace`,
   `clearEntry` from an error (resets to initial), negate on `"0"`
   no-op, `parseDisplay` on empty/`-`/`.`/garbage, `formatNumber` of
   non-finite values, operator-swap preserves the accumulator,
   `history.clear`/`remove` on an empty store do not re-persist, `makeId`
   fallback when `crypto.randomUUID` is absent, non-array JSON payloads,
   and keymap no-ops for `ArrowLeft`, `F1`, `Tab`, and non-string inputs.

3. **Top-of-file comments** added to the three original test files
   (`calculator.test.js`, `history.test.js`, `keymap.test.js`) describing
   the module under test and the behaviours the file exercises. No existing
   tests were modified, skipped, or disabled.

## Notes on task rubric vs. project shape

The task rubric calls out "same field names as backend API (check
server.js)" and "at least one integration test that makes real HTTP calls".
Step 1 (BackendMaster) shipped a pure-client calculator — no Express
server, no REST endpoints, no `server.js`. The `serve` script in
`calculator/package.json` is `python3 -m http.server`, a static file
server with no application endpoints.

Rather than fabricate a backend to satisfy a rubric clause that does not
apply, the integration layer tested here is the three-module seam the UI
will actually depend on: **keymap → calculator engine → history store**,
with the store round-tripping through its injected storage adapter (the
real `localStorage` in the browser, `createMemoryStorage()` in tests).
The `history persists across sessions via the same storage adapter` test
and the `typing '2 + 3 Enter' ...` test together exercise the exact
contract the browser UI will consume. Field names (`expression`, `result`,
`id`, `at`) in the tests match the shapes produced by
`evaluate()` in `src/calculator.js:215-220` and consumed by
`historyStore.add()` in `src/history.js:47-62`.

## How to reproduce

```sh
cd calculator
npm test                                   # 83 tests, ~120 ms
node --test --experimental-test-coverage \
     --test-coverage-include='src/**' \
     'test/*.test.js'                      # coverage report
```

## Bugs discovered

None. The engine, history store, and keymap delivered in step 1 pass every
scenario thrown at them, including the edge cases listed above.
