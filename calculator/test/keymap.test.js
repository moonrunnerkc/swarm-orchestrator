// Unit tests for the keyboard-to-action lookup (src/keymap.js): digit mapping,
// operator aliases (including Unicode ×/÷), Enter/=, Escape/Delete/Backspace,
// percent/underscore, and safe null return for unrecognised keys.

import test from "node:test";
import assert from "node:assert/strict";

import { ACTIONS, keyToAction } from "../src/keymap.js";

test("digits 0-9 map to digit actions carrying the key", () => {
  for (let i = 0; i <= 9; i++) {
    const k = String(i);
    assert.deepEqual(keyToAction(k), { type: ACTIONS.DIGIT, value: k });
  }
});

test("dot and comma both map to decimal", () => {
  assert.deepEqual(keyToAction("."), { type: ACTIONS.DECIMAL });
  assert.deepEqual(keyToAction(","), { type: ACTIONS.DECIMAL });
});

test("operators include both ascii and unicode aliases", () => {
  assert.deepEqual(keyToAction("+"), { type: ACTIONS.OPERATOR, value: "+" });
  assert.deepEqual(keyToAction("-"), { type: ACTIONS.OPERATOR, value: "-" });
  assert.deepEqual(keyToAction("*"), { type: ACTIONS.OPERATOR, value: "*" });
  assert.deepEqual(keyToAction("x"), { type: ACTIONS.OPERATOR, value: "*" });
  assert.deepEqual(keyToAction("×"), { type: ACTIONS.OPERATOR, value: "*" });
  assert.deepEqual(keyToAction("/"), { type: ACTIONS.OPERATOR, value: "/" });
  assert.deepEqual(keyToAction("÷"), { type: ACTIONS.OPERATOR, value: "/" });
});

test("Enter and = both evaluate", () => {
  assert.equal(keyToAction("Enter").type, ACTIONS.EQUALS);
  assert.equal(keyToAction("=").type, ACTIONS.EQUALS);
});

test("Escape clears all, Delete clears entry, Backspace deletes one digit", () => {
  assert.equal(keyToAction("Escape").type, ACTIONS.CLEAR_ALL);
  assert.equal(keyToAction("Delete").type, ACTIONS.CLEAR_ENTRY);
  assert.equal(keyToAction("Backspace").type, ACTIONS.BACKSPACE);
});

test("percent and underscore map to percent and negate", () => {
  assert.equal(keyToAction("%").type, ACTIONS.PERCENT);
  assert.equal(keyToAction("_").type, ACTIONS.NEGATE);
});

test("unrecognised keys return null so callers can ignore them", () => {
  assert.equal(keyToAction("a"), null);
  assert.equal(keyToAction("Shift"), null);
  assert.equal(keyToAction(""), null);
  assert.equal(keyToAction(undefined), null);
});
