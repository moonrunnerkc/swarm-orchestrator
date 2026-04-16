// Safe arithmetic expression evaluator. Recursive-descent parser over the
// grammar below; no `eval`, no `Function`, no dynamic code paths.
//
//   expr    := term (('+'|'-') term)*
//   term    := factor (('*'|'/') factor)*
//   factor  := ('+'|'-') factor | primary
//   primary := number | '(' expr ')'
//   number  := digits ('.' digits)?  |  '.' digits      (scientific notation
//              is also accepted: 1e3, 2.5e-4)

import { EvaluationError, ValidationError } from "./errors.js";

const TOKEN = {
  NUMBER: "number",
  OP: "op",
  LPAREN: "(",
  RPAREN: ")",
  END: "end",
};

function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      tokens.push({ type: c === "(" ? TOKEN.LPAREN : TOKEN.RPAREN, pos: i });
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ type: TOKEN.OP, value: c, pos: i });
      i++;
      continue;
    }
    if ((c >= "0" && c <= "9") || c === ".") {
      const start = i;
      while (i < input.length && input[i] >= "0" && input[i] <= "9") i++;
      if (input[i] === ".") {
        i++;
        while (i < input.length && input[i] >= "0" && input[i] <= "9") i++;
      }
      if (input[i] === "e" || input[i] === "E") {
        i++;
        if (input[i] === "+" || input[i] === "-") i++;
        const expStart = i;
        while (i < input.length && input[i] >= "0" && input[i] <= "9") i++;
        if (i === expStart) {
          throw new EvaluationError(
            `malformed number near position ${start}: missing exponent digits`,
            { position: start },
          );
        }
      }
      const raw = input.slice(start, i);
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new EvaluationError(
          `malformed number "${raw}" at position ${start}`,
          { position: start, token: raw },
        );
      }
      tokens.push({ type: TOKEN.NUMBER, value, pos: start });
      continue;
    }
    throw new EvaluationError(
      `unexpected character "${c}" at position ${i}`,
      { position: i, character: c },
    );
  }
  tokens.push({ type: TOKEN.END, pos: input.length });
  return tokens;
}

function parse(tokens) {
  let idx = 0;
  const peek = () => tokens[idx];
  const consume = () => tokens[idx++];

  const parseExpr = () => {
    let left = parseTerm();
    while (peek().type === TOKEN.OP && (peek().value === "+" || peek().value === "-")) {
      const op = consume().value;
      const right = parseTerm();
      left = apply(op, left, right);
    }
    return left;
  };

  const parseTerm = () => {
    let left = parseFactor();
    while (peek().type === TOKEN.OP && (peek().value === "*" || peek().value === "/")) {
      const opTok = consume();
      const right = parseFactor();
      left = apply(opTok.value, left, right, opTok.pos);
    }
    return left;
  };

  const parseFactor = () => {
    const tok = peek();
    if (tok.type === TOKEN.OP && (tok.value === "+" || tok.value === "-")) {
      consume();
      const operand = parseFactor();
      return tok.value === "-" ? -operand : operand;
    }
    return parsePrimary();
  };

  const parsePrimary = () => {
    const tok = consume();
    if (tok.type === TOKEN.NUMBER) return tok.value;
    if (tok.type === TOKEN.LPAREN) {
      const value = parseExpr();
      const closing = consume();
      if (closing.type !== TOKEN.RPAREN) {
        throw new EvaluationError(
          `expected ")" at position ${closing.pos}`,
          { position: closing.pos },
        );
      }
      return value;
    }
    if (tok.type === TOKEN.END) {
      throw new EvaluationError("expression is empty", { position: tok.pos });
    }
    throw new EvaluationError(
      `unexpected token at position ${tok.pos}`,
      { position: tok.pos, token: tok.value ?? tok.type },
    );
  };

  const result = parseExpr();
  const trailing = peek();
  if (trailing.type !== TOKEN.END) {
    throw new EvaluationError(
      `unexpected trailing token at position ${trailing.pos}`,
      { position: trailing.pos, token: trailing.value ?? trailing.type },
    );
  }
  return result;
}

function apply(op, left, right, pos) {
  switch (op) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/":
      if (right === 0) {
        throw new EvaluationError("division by zero", {
          operator: "/",
          position: pos,
        });
      }
      return left / right;
    default:
      throw new EvaluationError(`unknown operator "${op}"`, { operator: op });
  }
}

export function evaluateExpression(expression, { maxLength = 200 } = {}) {
  if (typeof expression !== "string") {
    throw new ValidationError("expression must be a string", {
      field: "expression",
      received: typeof expression,
    });
  }
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("expression must not be empty", {
      field: "expression",
    });
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(
      `expression exceeds maximum length of ${maxLength} characters (got ${trimmed.length})`,
      { field: "expression", maxLength, length: trimmed.length },
    );
  }

  const tokens = tokenize(trimmed);
  const value = parse(tokens);

  if (!Number.isFinite(value)) {
    throw new EvaluationError("result is not a finite number", {
      expression: trimmed,
      result: String(value),
    });
  }
  // Strip binary floating-point noise the same way the UI does.
  const rounded = Number.parseFloat(value.toPrecision(12));
  return { expression: trimmed, result: rounded };
}
