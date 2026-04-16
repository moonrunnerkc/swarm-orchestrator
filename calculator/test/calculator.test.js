// Unit tests for the pure calculator engine (src/calculator.js): state
// transitions for digit entry, operators, chaining, evaluate (with repeated
// `=`), clear/backspace/negate/percent, division-by-zero error handling, and
// state-freezing invariants.

import test from "node:test";
import assert from "node:assert/strict";

import {
  apply,
  backspace,
  clearAll,
  clearEntry,
  evaluate,
  formatNumber,
  initialState,
  inputDecimal,
  inputDigit,
  inputOperator,
  negate,
  percent,
} from "../src/calculator.js";

const press = (state, ...keys) => keys.reduce((s, k) => {
  if (/^[0-9]$/.test(k)) return inputDigit(s, k);
  if (k === ".") return inputDecimal(s);
  if (k === "+" || k === "-" || k === "*" || k === "/") return inputOperator(s, k);
  if (k === "=") return evaluate(s).state;
  if (k === "C") return clearAll();
  if (k === "CE") return clearEntry(s);
  if (k === "<") return backspace(s);
  if (k === "±") return negate(s);
  if (k === "%") return percent(s);
  throw new Error(`unknown press: ${k}`);
}, state);

test("initialState shows 0 with no pending operation", () => {
  const s = initialState();
  assert.equal(s.display, "0");
  assert.equal(s.accumulator, null);
  assert.equal(s.pendingOp, null);
  assert.equal(s.error, null);
});

test("digits replace the leading zero rather than appending", () => {
  let s = inputDigit(initialState(), "7");
  assert.equal(s.display, "7");
  s = inputDigit(s, "3");
  assert.equal(s.display, "73");
});

test("decimal can be added once and is ignored on repeat", () => {
  let s = press(initialState(), "1", ".", "5");
  assert.equal(s.display, "1.5");
  s = inputDecimal(s);
  assert.equal(s.display, "1.5");
});

test("decimal after equals starts a fresh 0.", () => {
  const s = press(initialState(), "2", "+", "3", "=", ".");
  assert.equal(s.display, "0.");
});

test("addition computes 2 + 3 = 5", () => {
  const s = press(initialState(), "2", "+", "3", "=");
  assert.equal(s.display, "5");
});

test("chained operations apply left to right: 2 + 3 * 4 = 20", () => {
  const s = press(initialState(), "2", "+", "3", "*", "4", "=");
  assert.equal(s.display, "20");
});

test("operator chain folds running total at each operator", () => {
  const s = press(initialState(), "1", "+", "2", "+", "3", "+", "4");
  // After typing the last digit the display shows what was typed (4) while
  // the running total lives in the accumulator until the next operator/=.
  assert.equal(s.display, "4");
  assert.equal(s.accumulator, 6);
  const final = evaluate(s).state;
  assert.equal(final.display, "10");
});

test("pressing two operators in a row swaps the pending op", () => {
  const s = press(initialState(), "5", "+", "-", "2", "=");
  assert.equal(s.display, "3");
});

test("repeated equals re-applies the last operator and operand", () => {
  let s = press(initialState(), "5", "+", "2", "=");
  assert.equal(s.display, "7");
  s = evaluate(s).state;
  assert.equal(s.display, "9");
  s = evaluate(s).state;
  assert.equal(s.display, "11");
});

test("typing a digit after equals starts a fresh calculation", () => {
  let s = press(initialState(), "2", "+", "3", "=");
  assert.equal(s.display, "5");
  s = inputDigit(s, "9");
  assert.equal(s.display, "9");
  assert.equal(s.accumulator, null);
  assert.equal(s.pendingOp, null);
});

test("division by zero produces an error state with a specific message", () => {
  const s = press(initialState(), "8", "/", "0", "=");
  assert.equal(s.display, "Error");
  assert.match(s.error, /divide by zero/);
});

test("clearAll wipes any error and returns to 0", () => {
  const errored = press(initialState(), "8", "/", "0", "=");
  const cleared = clearAll();
  assert.equal(cleared.display, "0");
  assert.equal(cleared.error, null);
  assert.notEqual(errored.error, null);
});

test("clearEntry only clears the current entry, preserving the running total", () => {
  let s = press(initialState(), "5", "+", "3");
  s = clearEntry(s);
  assert.equal(s.display, "0");
  assert.equal(s.accumulator, 5);
  s = press(s, "7", "=");
  assert.equal(s.display, "12");
});

test("backspace removes the rightmost digit", () => {
  let s = press(initialState(), "1", "2", "3");
  s = backspace(s);
  assert.equal(s.display, "12");
  s = backspace(s);
  s = backspace(s);
  assert.equal(s.display, "0");
});

test("backspace is a no-op while awaiting an operand", () => {
  let s = press(initialState(), "5", "+");
  s = backspace(s);
  assert.equal(s.display, "5");
  assert.equal(s.pendingOp, "+");
});

test("negate toggles the sign on the current display", () => {
  let s = press(initialState(), "4", "2");
  s = negate(s);
  assert.equal(s.display, "-42");
  s = negate(s);
  assert.equal(s.display, "42");
});

test("percent divides the display by 100", () => {
  const s = percent(press(initialState(), "5", "0"));
  assert.equal(s.display, "0.5");
});

test("evaluate returns a history entry describing the calculation", () => {
  const start = press(initialState(), "6", "*", "7");
  const { entry } = evaluate(start);
  assert.deepEqual(entry, { expression: "6 * 7", result: "42" });
});

test("apply returns specific errors for divide-by-zero and bad operators", () => {
  assert.deepEqual(apply(1, "/", 0), { error: "cannot divide by zero" });
  assert.match(apply(1, "?", 1).error, /unknown operator/);
  assert.match(apply(NaN, "+", 1).error, /non-finite/);
});

test("formatNumber strips floating-point noise from 0.1 + 0.2", () => {
  assert.equal(formatNumber(0.1 + 0.2), "0.3");
  assert.equal(formatNumber(-0), "0");
  assert.equal(formatNumber(1e20), "100000000000000000000");
});

test("inputDigit rejects non-digit input with a clear message", () => {
  assert.throws(() => inputDigit(initialState(), "a"), /single digit/);
  assert.throws(() => inputDigit(initialState(), "12"), /single digit/);
});

test("inputOperator rejects unknown operators", () => {
  assert.throws(() => inputOperator(initialState(), "?"), /unknown operator/);
});

test("once an error is set, subsequent inputs are no-ops until clearAll", () => {
  const errored = press(initialState(), "1", "/", "0", "=");
  assert.equal(inputDigit(errored, "5").display, "Error");
  assert.equal(inputOperator(errored, "+").display, "Error");
});

test("state objects are frozen so callers cannot mutate them in place", () => {
  const s = inputDigit(initialState(), "5");
  assert.throws(() => { s.display = "boom"; }, TypeError);
});
