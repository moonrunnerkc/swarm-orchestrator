import type { JsonValue } from "./canonical-json.ts";

export class PredicateParseError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PredicateParseError";
  }
}

type ComparisonOperator = "==" | "!=" | ">=" | "<=" | ">" | "<";

type PredicateOperand =
  | { readonly kind: "path"; readonly path: readonly string[]; readonly source: string }
  | { readonly kind: "literal"; readonly value: string | number | boolean | null };

type PredicateNode =
  | {
      readonly kind: "compare";
      readonly operator: ComparisonOperator;
      readonly left: PredicateOperand;
      readonly right: PredicateOperand;
    }
  | { readonly kind: "and" | "or"; readonly left: PredicateNode; readonly right: PredicateNode };

type PredicateFailure = "path-not-found" | "type-mismatch";

type PredicateResult =
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly failure: PredicateFailure; readonly detail: string };

const comparisonOperators: readonly ComparisonOperator[] = ["==", "!=", ">=", "<=", ">", "<"];

interface Token {
  readonly kind: "path" | "number" | "string" | "keyword" | "operator" | "paren";
  readonly text: string;
}

/**
 * The whole predicate language: dotted paths into a record's payload, JSON literals, six
 * comparisons, and && / || with parentheses. Deliberately not an expression evaluator: a
 * claim has to be checkable by a hundred-line verifier a reviewer can read in one sitting.
 */
export function parsePredicate(source: string): PredicateNode {
  const tokens = tokenize(source);
  if (tokens.length === 0) {
    throw new PredicateParseError("the predicate is empty");
  }

  let position = 0;
  const peek = (): Token | undefined => tokens[position];

  const parseOperand = (): PredicateOperand => {
    const token = tokens[position];
    if (token === undefined) {
      throw new PredicateParseError("the predicate ends where a value was expected");
    }
    position += 1;
    if (token.kind === "path") {
      return { kind: "path", path: token.text.split("."), source: token.text };
    }
    if (token.kind === "number") {
      return { kind: "literal", value: Number(token.text) };
    }
    if (token.kind === "string") {
      return { kind: "literal", value: token.text };
    }
    if (token.kind === "keyword") {
      return { kind: "literal", value: token.text === "null" ? null : token.text === "true" };
    }
    throw new PredicateParseError(`"${token.text}" is not a value`);
  };

  const parseUnit = (): PredicateNode => {
    const token = peek();
    if (token?.kind === "paren" && token.text === "(") {
      position += 1;
      const inner = parseOr();
      const closing = tokens[position];
      if (closing?.text !== ")") {
        throw new PredicateParseError("an opening parenthesis is never closed");
      }
      position += 1;
      return inner;
    }

    const left = parseOperand();
    const operator = tokens[position];
    if (operator === undefined || operator.kind !== "operator") {
      throw new PredicateParseError(
        `expected one of ${comparisonOperators.join(" ")} after "${describeOperand(left)}"`,
      );
    }
    if (!isComparison(operator.text)) {
      throw new PredicateParseError(`"${operator.text}" is not a comparison operator`);
    }
    position += 1;
    const right = parseOperand();
    return { kind: "compare", operator: operator.text, left, right };
  };

  const parseAnd = (): PredicateNode => {
    let node = parseUnit();
    while (peek()?.text === "&&") {
      position += 1;
      node = { kind: "and", left: node, right: parseUnit() };
    }
    return node;
  };

  function parseOr(): PredicateNode {
    let node = parseAnd();
    while (peek()?.text === "||") {
      position += 1;
      node = { kind: "or", left: node, right: parseAnd() };
    }
    return node;
  }

  const node = parseOr();
  const trailing = tokens[position];
  if (trailing !== undefined) {
    throw new PredicateParseError(`unexpected "${trailing.text}" after the end of the predicate`);
  }
  return node;
}

/**
 * Evaluates against one record payload. && and || do not short-circuit: a broken path on
 * the ignored side of a false conjunction still has to surface, because "the claim cites a
 * field that does not exist" is a different reviewer signal from "the claim is false".
 */
export function evaluatePredicate(node: PredicateNode, subject: JsonValue): PredicateResult {
  if (node.kind === "compare") {
    const left = resolveOperand(node.left, subject);
    if (!left.ok) {
      return left;
    }
    const right = resolveOperand(node.right, subject);
    if (!right.ok) {
      return right;
    }
    return compare(node.operator, left.value, right.value);
  }

  const left = evaluatePredicate(node.left, subject);
  const right = evaluatePredicate(node.right, subject);
  if (!left.ok) {
    return left;
  }
  if (!right.ok) {
    return right;
  }
  return {
    ok: true,
    value: node.kind === "and" ? left.value && right.value : left.value || right.value,
  };
}

function describeOperand(operand: PredicateOperand): string {
  return operand.kind === "path" ? operand.source : JSON.stringify(operand.value);
}

type Resolved =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly failure: PredicateFailure; readonly detail: string };

function resolveOperand(operand: PredicateOperand, subject: JsonValue): Resolved {
  if (operand.kind === "literal") {
    return { ok: true, value: operand.value };
  }

  let current: JsonValue = subject;
  for (const segment of operand.path) {
    if (current === null || typeof current !== "object") {
      return {
        ok: false,
        failure: "path-not-found",
        detail: `${operand.source} does not exist in the cited record`,
      };
    }
    const next = Array.isArray(current)
      ? current[Number(segment)]
      : (current as { readonly [key: string]: JsonValue })[segment];
    if (next === undefined) {
      return {
        ok: false,
        failure: "path-not-found",
        detail: `${operand.source} does not exist in the cited record`,
      };
    }
    current = next;
  }
  return { ok: true, value: current };
}

function compare(operator: ComparisonOperator, left: JsonValue, right: JsonValue): PredicateResult {
  if (operator === "==" || operator === "!=") {
    if (!isPrimitive(left) || !isPrimitive(right)) {
      return {
        ok: false,
        failure: "type-mismatch",
        detail: `${operator} compares primitives, and one side is an object or array`,
      };
    }
    const equal = left === right;
    return { ok: true, value: operator === "==" ? equal : !equal };
  }

  if (typeof left !== "number" || typeof right !== "number") {
    return {
      ok: false,
      failure: "type-mismatch",
      detail: `${operator} compares numbers, got ${describeType(left)} and ${describeType(right)}`,
    };
  }

  switch (operator) {
    case ">=":
      return { ok: true, value: left >= right };
    case "<=":
      return { ok: true, value: left <= right };
    case ">":
      return { ok: true, value: left > right };
    case "<":
      return { ok: true, value: left < right };
  }
}

function isPrimitive(value: JsonValue): value is string | number | boolean | null {
  return value === null || typeof value !== "object";
}

function describeType(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
}

function isComparison(text: string): text is ComparisonOperator {
  return (comparisonOperators as readonly string[]).includes(text);
}

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index] ?? "";

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === "(" || character === ")") {
      tokens.push({ kind: "paren", text: character });
      index += 1;
      continue;
    }

    const twoCharacter = source.slice(index, index + 2);
    if (["&&", "||", "==", "!=", ">=", "<="].includes(twoCharacter)) {
      tokens.push({ kind: "operator", text: twoCharacter });
      index += 2;
      continue;
    }

    if (character === ">" || character === "<") {
      tokens.push({ kind: "operator", text: character });
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      const end = source.indexOf(character, index + 1);
      if (end === -1) {
        throw new PredicateParseError(`an opening ${character} is never closed`);
      }
      tokens.push({ kind: "string", text: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }

    const remainder = source.slice(index);
    const number = /^-?\d+(?:\.\d+)?/.exec(remainder);
    if (number !== null) {
      tokens.push({ kind: "number", text: number[0] });
      index += number[0].length;
      continue;
    }

    const path = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*/.exec(remainder);
    if (path !== null) {
      const text = path[0];
      tokens.push({
        kind: ["true", "false", "null"].includes(text) ? "keyword" : "path",
        text,
      });
      index += text.length;
      continue;
    }

    throw new PredicateParseError(`"${character}" is not valid in a predicate`);
  }

  return tokens;
}
