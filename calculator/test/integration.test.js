// End-to-end integration tests that wire keymap + calculator + history
// together the same way the browser UI will: each simulated KeyboardEvent.key
// is routed through keyToAction, dispatched against the calculator engine,
// and any history entry produced by `evaluate` is written to the store.
//
// This is the integration seam for a pure-client calculator — there is no
// backend HTTP API (`npm run serve` only exposes the static files), so the
// meaningful "integration" surface is the three modules working together and
// the history store round-tripping through its storage adapter.

import test from "node:test";
import assert from "node:assert/strict";

import {
  backspace,
  clearAll,
  clearEntry,
  evaluate,
  initialState,
  inputDecimal,
  inputDigit,
  inputOperator,
  negate,
  percent,
} from "../src/calculator.js";
import { createHistoryStore, createMemoryStorage } from "../src/history.js";
import { ACTIONS, keyToAction } from "../src/keymap.js";

// Mirror of the intended UI wiring: keymap decodes the key, the engine
// produces a new state, and any emitted history entry is persisted.
function createSession({ storage = createMemoryStorage(), now } = {}) {
  const history = createHistoryStore(storage, now ? { now } : undefined);
  let state = initialState();

  function dispatch(key) {
    const action = keyToAction(key);
    if (!action) return { state, entry: null, handled: false };
    switch (action.type) {
      case ACTIONS.DIGIT:
        state = inputDigit(state, action.value);
        return { state, entry: null, handled: true };
      case ACTIONS.DECIMAL:
        state = inputDecimal(state);
        return { state, entry: null, handled: true };
      case ACTIONS.OPERATOR:
        state = inputOperator(state, action.value);
        return { state, entry: null, handled: true };
      case ACTIONS.EQUALS: {
        const result = evaluate(state);
        state = result.state;
        if (result.entry) history.add(result.entry);
        return { state, entry: result.entry ?? null, handled: true };
      }
      case ACTIONS.CLEAR_ALL:
        state = clearAll();
        return { state, entry: null, handled: true };
      case ACTIONS.CLEAR_ENTRY:
        state = clearEntry(state);
        return { state, entry: null, handled: true };
      case ACTIONS.BACKSPACE:
        state = backspace(state);
        return { state, entry: null, handled: true };
      case ACTIONS.NEGATE:
        state = negate(state);
        return { state, entry: null, handled: true };
      case ACTIONS.PERCENT:
        state = percent(state);
        return { state, entry: null, handled: true };
      default:
        return { state, entry: null, handled: false };
    }
  }

  function type(keys) {
    let last = null;
    for (const k of keys) last = dispatch(k);
    return last;
  }

  return {
    dispatch,
    type,
    get state() { return state; },
    history,
  };
}

const fakeClock = (start = 1_700_000_000_000) => {
  let t = start;
  return () => ++t;
};

test("integration: typing '2 + 3 Enter' updates display and writes one history entry", () => {
  const session = createSession({ now: fakeClock() });
  session.type(["2", "+", "3", "Enter"]);
  assert.equal(session.state.display, "5");
  assert.equal(session.history.size, 1);
  const [entry] = session.history.list();
  assert.equal(entry.expression, "2 + 3");
  assert.equal(entry.result, "5");
  assert.equal(typeof entry.id, "string");
  assert.ok(entry.id.length > 0);
  assert.ok(Number.isFinite(entry.at));
});

test("integration: chained calculation '2 + 3 * 4 =' folds left-to-right", () => {
  const session = createSession();
  session.type(["2", "+", "3", "*", "4", "="]);
  assert.equal(session.state.display, "20");
  assert.equal(session.history.size, 1);
  assert.deepEqual(
    session.history.list()[0].expression + " = " + session.history.list()[0].result,
    "5 * 4 = 20",
  );
});

test("integration: repeated Enter re-applies last op/operand and logs each result", () => {
  const session = createSession({ now: fakeClock() });
  session.type(["5", "+", "2", "Enter"]);
  assert.equal(session.state.display, "7");
  session.dispatch("Enter");
  assert.equal(session.state.display, "9");
  session.dispatch("Enter");
  assert.equal(session.state.display, "11");
  assert.equal(session.history.size, 3);
  const results = session.history.list().map((e) => e.result);
  assert.deepEqual(results, ["11", "9", "7"]); // newest first
});

test("integration: Unicode × and ÷ keys dispatch the same as * and /", () => {
  const session = createSession();
  session.type(["6", "×", "7", "="]);
  assert.equal(session.state.display, "42");
  session.type(["Escape", "8", "÷", "2", "="]);
  assert.equal(session.state.display, "4");
  assert.equal(session.history.size, 2);
});

test("integration: unrecognised keys are reported as not-handled and leave state untouched", () => {
  const session = createSession();
  session.type(["1", "2"]);
  const before = session.state;
  const result = session.dispatch("Shift");
  assert.equal(result.handled, false);
  assert.strictEqual(result.state, before);
  assert.equal(session.state.display, "12");
});

test("integration: Escape after a calculation returns to the initial state", () => {
  const session = createSession();
  session.type(["9", "+", "1", "=", "Escape"]);
  assert.equal(session.state.display, "0");
  assert.equal(session.state.accumulator, null);
  assert.equal(session.state.pendingOp, null);
  assert.equal(session.state.error, null);
});

test("integration: Delete clears current entry but keeps the running total", () => {
  const session = createSession();
  session.type(["5", "+", "9", "Delete", "3", "="]);
  assert.equal(session.state.display, "8");
});

test("integration: Backspace trims the last typed digit", () => {
  const session = createSession();
  session.type(["1", "2", "3", "Backspace"]);
  assert.equal(session.state.display, "12");
});

test("integration: percent and underscore keys operate on the current entry", () => {
  const session = createSession();
  session.type(["5", "0", "%"]);
  assert.equal(session.state.display, "0.5");
  session.type(["Escape", "7", "_"]);
  assert.equal(session.state.display, "-7");
});

test("integration: decimal entry via comma or dot both start a fractional number", () => {
  const dotSession = createSession();
  dotSession.type(["0", ".", "2", "5"]);
  assert.equal(dotSession.state.display, "0.25");

  const commaSession = createSession();
  commaSession.type(["0", ",", "2", "5"]);
  assert.equal(commaSession.state.display, "0.25");
});

test("integration: division by zero surfaces an Error display and no history entry", () => {
  const session = createSession();
  session.type(["8", "/", "0", "="]);
  assert.equal(session.state.display, "Error");
  assert.match(session.state.error, /divide by zero/);
  assert.equal(session.history.size, 0);
});

test("integration: history persists across sessions via the same storage adapter", () => {
  const storage = createMemoryStorage();
  const first = createSession({ storage, now: fakeClock() });
  first.type(["7", "+", "8", "="]);
  assert.equal(first.state.display, "15");
  assert.equal(first.history.size, 1);

  const second = createSession({ storage });
  assert.equal(second.history.size, 1);
  assert.equal(second.history.list()[0].result, "15");
});

test("integration: history remains bounded across many calculations", () => {
  const storage = createMemoryStorage();
  const session = createSession({ storage, now: fakeClock() });
  // default limit is 50; run 60 calculations
  for (let i = 1; i <= 60; i++) {
    session.type(["Escape"]);
    const digits = String(i).split("");
    session.type([...digits, "+", "0", "="]);
  }
  assert.equal(session.history.size, 50);
  // newest entry should be "60 + 0" with result "60"
  const [newest] = session.history.list();
  assert.equal(newest.result, "60");
});

test("integration: typing '0.1 + 0.2 =' produces the rounded 0.3 both on screen and in history", () => {
  const session = createSession();
  session.type(["0", ".", "1", "+", "0", ".", "2", "="]);
  assert.equal(session.state.display, "0.3");
  const [entry] = session.history.list();
  assert.equal(entry.expression, "0.1 + 0.2");
  assert.equal(entry.result, "0.3");
});

test("integration: negate + digits + evaluate round-trips through to a history entry", () => {
  const session = createSession();
  session.type(["5", "_", "+", "3", "="]);
  assert.equal(session.state.display, "-2");
  const [entry] = session.history.list();
  assert.equal(entry.expression, "-5 + 3");
  assert.equal(entry.result, "-2");
});
