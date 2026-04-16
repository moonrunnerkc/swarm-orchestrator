// Pure calculator engine. No DOM, no storage, no timers — every transition
// returns a fresh frozen state so the UI layer can render from snapshots and
// the tests can drive the engine without any harness.

export const OPERATORS = Object.freeze(["+", "-", "*", "/"]);

const MAX_DIGITS = 16;

export function initialState() {
  return Object.freeze({
    display: "0",
    accumulator: null,
    pendingOp: null,
    lastOp: null,
    lastOperand: null,
    awaitingOperand: false,
    justEvaluated: false,
    error: null,
  });
}

export function inputDigit(state, digit) {
  if (typeof digit !== "string" || digit.length !== 1 || digit < "0" || digit > "9") {
    throw new RangeError(`expected a single digit '0'..'9', got ${JSON.stringify(digit)}`);
  }
  if (state.error) return state;
  if (state.awaitingOperand || state.justEvaluated || state.display === "0") {
    const seed = state.justEvaluated && !state.awaitingOperand
      ? { ...state, accumulator: null, pendingOp: null, lastOp: null, lastOperand: null }
      : state;
    return freeze({
      ...seed,
      display: digit,
      awaitingOperand: false,
      justEvaluated: false,
    });
  }
  const next = state.display + digit;
  if (countDigits(next) > MAX_DIGITS) return state;
  return freeze({ ...state, display: next });
}

export function inputDecimal(state) {
  if (state.error) return state;
  if (state.awaitingOperand || state.justEvaluated) {
    return freeze({
      ...state,
      display: "0.",
      awaitingOperand: false,
      justEvaluated: false,
    });
  }
  if (state.display.includes(".")) return state;
  return freeze({ ...state, display: state.display + "." });
}

export function backspace(state) {
  if (state.error) return state;
  if (state.justEvaluated || state.awaitingOperand) return state;
  const trimmed = state.display.slice(0, -1);
  const next = trimmed === "" || trimmed === "-" ? "0" : trimmed;
  return freeze({ ...state, display: next });
}

export function negate(state) {
  if (state.error) return state;
  if (state.display === "0") return state;
  const next = state.display.startsWith("-") ? state.display.slice(1) : "-" + state.display;
  return freeze({ ...state, display: next, justEvaluated: false });
}

export function percent(state) {
  if (state.error) return state;
  const value = parseDisplay(state.display) / 100;
  return freeze({
    ...state,
    display: formatNumber(value),
    awaitingOperand: false,
    justEvaluated: false,
  });
}

export function inputOperator(state, op) {
  if (!OPERATORS.includes(op)) {
    throw new RangeError(`unknown operator ${JSON.stringify(op)}; expected one of ${OPERATORS.join(", ")}`);
  }
  if (state.error) return state;

  // Nothing typed yet since the last op — just swap which op is pending.
  if (state.awaitingOperand && state.accumulator !== null) {
    return freeze({ ...state, pendingOp: op });
  }

  const current = parseDisplay(state.display);

  if (state.accumulator === null || state.pendingOp === null) {
    return freeze({
      ...state,
      accumulator: current,
      pendingOp: op,
      awaitingOperand: true,
      justEvaluated: false,
      display: formatNumber(current),
    });
  }

  const result = apply(state.accumulator, state.pendingOp, current);
  if (result.error) {
    return freeze({ ...state, error: result.error, display: "Error", awaitingOperand: false });
  }
  return freeze({
    ...state,
    accumulator: result.value,
    pendingOp: op,
    display: formatNumber(result.value),
    awaitingOperand: true,
    justEvaluated: false,
  });
}

export function evaluate(state) {
  if (state.error) return { state, entry: null };

  // Repeated `=` re-applies the last operator and operand pair against the
  // current display, e.g. 5 + 2 = 7, =, =, = → 9, 11, 13.
  if (state.pendingOp === null) {
    if (state.lastOp === null || state.lastOperand === null) {
      return { state, entry: null };
    }
    const current = parseDisplay(state.display);
    const result = apply(current, state.lastOp, state.lastOperand);
    if (result.error) {
      return { state: errorState(state, result.error), entry: null };
    }
    const next = freeze({
      ...state,
      display: formatNumber(result.value),
      accumulator: result.value,
      awaitingOperand: false,
      justEvaluated: true,
    });
    return {
      state: next,
      entry: makeEntry(current, state.lastOp, state.lastOperand, result.value),
    };
  }

  const left = state.accumulator ?? 0;
  const right = parseDisplay(state.display);
  const result = apply(left, state.pendingOp, right);
  if (result.error) {
    return { state: errorState(state, result.error), entry: null };
  }
  const next = freeze({
    ...state,
    display: formatNumber(result.value),
    accumulator: result.value,
    pendingOp: null,
    lastOp: state.pendingOp,
    lastOperand: right,
    awaitingOperand: false,
    justEvaluated: true,
  });
  return {
    state: next,
    entry: makeEntry(left, state.pendingOp, right, result.value),
  };
}

export function clearAll() {
  return initialState();
}

export function clearEntry(state) {
  if (state.error) return initialState();
  return freeze({
    ...state,
    display: "0",
    awaitingOperand: false,
    justEvaluated: false,
  });
}

export function apply(a, op, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { error: `non-finite operand in ${a} ${op} ${b}` };
  }
  switch (op) {
    case "+": return { value: a + b };
    case "-": return { value: a - b };
    case "*": return { value: a * b };
    case "/":
      if (b === 0) return { error: "cannot divide by zero" };
      return { value: a / b };
    default:
      return { error: `unknown operator: ${op}` };
  }
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return "Error";
  // Round to 12 significant digits to strip floating-point noise (e.g.
  // 0.1 + 0.2 = 0.30000000000000004) while preserving exact integers.
  const rounded = Number.parseFloat(value.toPrecision(12));
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

export function parseDisplay(display) {
  if (display === "" || display === "-" || display === ".") return 0;
  const n = Number(display);
  return Number.isFinite(n) ? n : 0;
}

function makeEntry(left, op, right, value) {
  return {
    expression: `${formatNumber(left)} ${op} ${formatNumber(right)}`,
    result: formatNumber(value),
  };
}

function errorState(state, message) {
  return freeze({ ...state, error: message, display: "Error", awaitingOperand: false });
}

function countDigits(s) {
  let n = 0;
  for (const ch of s) if (ch >= "0" && ch <= "9") n++;
  return n;
}

function freeze(obj) {
  return Object.freeze(obj);
}
