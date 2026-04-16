// Translate KeyboardEvent.key strings into calculator actions. Pure lookup
// so the UI layer stays a thin dispatcher and the mapping is unit-testable.

export const ACTIONS = Object.freeze({
  DIGIT: "digit",
  DECIMAL: "decimal",
  OPERATOR: "operator",
  EQUALS: "equals",
  CLEAR_ALL: "clear-all",
  CLEAR_ENTRY: "clear-entry",
  BACKSPACE: "backspace",
  NEGATE: "negate",
  PERCENT: "percent",
});

const STATIC = new Map([
  [".", { type: ACTIONS.DECIMAL }],
  [",", { type: ACTIONS.DECIMAL }],
  ["+", { type: ACTIONS.OPERATOR, value: "+" }],
  ["-", { type: ACTIONS.OPERATOR, value: "-" }],
  ["*", { type: ACTIONS.OPERATOR, value: "*" }],
  ["x", { type: ACTIONS.OPERATOR, value: "*" }],
  ["X", { type: ACTIONS.OPERATOR, value: "*" }],
  ["/", { type: ACTIONS.OPERATOR, value: "/" }],
  ["÷", { type: ACTIONS.OPERATOR, value: "/" }],
  ["×", { type: ACTIONS.OPERATOR, value: "*" }],
  ["=", { type: ACTIONS.EQUALS }],
  ["Enter", { type: ACTIONS.EQUALS }],
  ["Backspace", { type: ACTIONS.BACKSPACE }],
  ["Delete", { type: ACTIONS.CLEAR_ENTRY }],
  ["Escape", { type: ACTIONS.CLEAR_ALL }],
  ["%", { type: ACTIONS.PERCENT }],
  ["_", { type: ACTIONS.NEGATE }],
]);

export function keyToAction(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  if (key.length === 1 && key >= "0" && key <= "9") {
    return { type: ACTIONS.DIGIT, value: key };
  }
  return STATIC.get(key) ?? null;
}
