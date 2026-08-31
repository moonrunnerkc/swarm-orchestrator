/**
 * Tracks what a value is across the lines that build it, so two checks that both lose to a
 * per-line reader can share one answer.
 *
 * The two are a comparison that reduces to itself and a credential written in pieces. They
 * look unrelated and they fail the same way: every individual line is ordinary, and what makes
 * the whole what it is spans the assignment above it. So the substitution is written once here
 * and both callers ask it the same question.
 *
 * Deliberately not an interpreter. It substitutes bindings whose value is inert, which is a
 * literal or a path of property reads, and it declines wherever a name could mean two things:
 * a name assigned twice, a binding that mentions itself, an expression carrying a call. A
 * decline is a miss rather than a false positive, which is the direction both callers want,
 * because one of them refuses to count an assertion and the other blocks a change.
 */

/** Names to the expression each was bound to, minus every name that could mean two things. */
export type Bindings = ReadonlyMap<string, string>;

const declaration = /(?:^|[\s;{}(])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;

/** A literal a reader can evaluate on sight. */
const inertLiteral =
  /^(?:'[^'\\]*'|"[^"\\]*"|`[^`$\\]*`|-?\d+(?:\.\d+)?|true|false|null|undefined)$/;

/** Identifiers, property reads, and constant indices. No call, no operator, no await. */
const inertPath = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|'[^']*'|"[^"]*")\])*$/;

const substitutionRounds = 5;

function isInert(expression: string): boolean {
  return inertLiteral.test(expression) || inertPath.test(expression);
}

/**
 * Every `const`, `let` and `var` in the text, minus the ambiguous ones. A name declared twice
 * is dropped rather than resolved to its last value: which one an occurrence means depends on
 * where it sits, and this reads no scopes.
 */
export function bindingsIn(text: string): Bindings {
  const bound = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const match of text.matchAll(declaration)) {
    const name = match[1];
    const expression = match[2]?.trim().replace(/;+$/, "").trim();
    if (name === undefined || expression === undefined || expression.length === 0) {
      continue;
    }
    if (bound.has(name) && bound.get(name) !== expression) {
      ambiguous.add(name);
    }
    // A binding mentioning itself resolves to nothing this can follow.
    if (new RegExp(String.raw`\b${escaped(name)}\b`).test(expression)) {
      ambiguous.add(name);
    }
    bound.set(name, expression);
  }

  for (const name of ambiguous) {
    bound.delete(name);
  }
  return bound;
}

/**
 * The expression with every inert binding substituted, to a fixed point. A binding whose own
 * expression is not inert is left as the name it was written as, which is correct for both
 * callers: two sides that both read the same non-inert name are still the same value.
 */
export function resolveExpression(expression: string, bindings: Bindings): string {
  let current = expression.trim();
  for (let round = 0; round < substitutionRounds; round += 1) {
    const next = current.replaceAll(/[A-Za-z_$][\w$]*/g, (name) => {
      const bound = bindings.get(name);
      return bound !== undefined && isInert(bound) ? bound : name;
    });
    if (next === current) {
      break;
    }
    current = next;
  }
  return current.replaceAll(/\s+/g, " ").trim();
}

/**
 * Whether the line compares a value with itself.
 *
 * True only where both sides resolve to the same inert expression. The inertness is what keeps
 * a memoization test counting: `expect(cache.get('k')).toBe(cache.get('k'))` compares two calls
 * and is a real assertion about identity, and a call is never inert. What is left is a property
 * read against the same property read, which holds whatever the code under test does.
 */
export function assertsIdentity(line: string, bindings: Bindings): boolean {
  const pair = comparedPair(line);
  if (pair === null) {
    return false;
  }
  const left = resolveExpression(pair[0], bindings);
  const right = resolveExpression(pair[1], bindings);
  return left === right && isInert(left);
}

/** The two sides of an equality assertion, in either of the spellings this counts. */
function comparedPair(line: string): readonly [string, string] | null {
  return expectPair(line) ?? assertPair(line);
}

function expectPair(line: string): readonly [string, string] | null {
  const opened = /\bexpect\s*\(/.exec(line);
  if (opened === null) {
    return null;
  }
  const subject = balanced(line, opened.index + opened[0].length - 1);
  if (subject === null) {
    return null;
  }
  const rest = line.slice(subject.end);
  const matcher = /^\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(/.exec(rest);
  if (matcher === null) {
    return null;
  }
  const expected = balanced(rest, matcher[0].length - 1);
  return expected === null ? null : [subject.inner, expected.inner];
}

function assertPair(line: string): readonly [string, string] | null {
  const opened = /\bassert\s*\.\s*(?:equal|strictEqual|deepEqual|deepStrictEqual)\s*\(/.exec(line);
  if (opened === null) {
    return null;
  }
  const args = balanced(line, opened.index + opened[0].length - 1);
  if (args === null) {
    return null;
  }
  const split = topLevelComma(args.inner);
  return split === null ? null : [args.inner.slice(0, split), args.inner.slice(split + 1)];
}

interface BalancedSpan {
  readonly inner: string;
  /** Index just past the closing bracket, in the string that was scanned. */
  readonly end: number;
}

/** What sits between one bracket and the one that closes it, quotes respected. */
function balanced(text: string, openIndex: number): BalancedSpan | null {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quote !== "") {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) {
        return { inner: text.slice(openIndex + 1, index).trim(), end: index + 1 };
      }
    }
  }
  return null;
}

/** The comma separating two arguments, ignoring the ones inside brackets and quotes. */
function topLevelComma(text: string): number | null {
  let depth = 0;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quote !== "") {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      return index;
    }
  }
  return null;
}

/** A string a `+` chain builds, and where every piece of it was written. */
export interface Reassembly {
  readonly value: string;
  /** Every span in the text that carries a piece of the value, so all of it can be redacted. */
  readonly spans: readonly { readonly start: number; readonly end: number }[];
}

const stringOperand = String.raw`[A-Za-z_$][\w$]*|'[^'\n]*'|"[^"\n]*"`;
const concatenation = new RegExp(
  String.raw`(${stringOperand})(?:\s*\+\s*(?:${stringOperand}))+`,
  "g",
);

/**
 * Every string a concatenation in the text builds out of pieces this can resolve.
 *
 * The field names are not consulted, which is the point: the gap this closes is a value split
 * across names that say nothing. What is consulted is whether every operand resolves to a
 * string literal, so a chain carrying one runtime value produces nothing rather than a guess.
 */
export function reassembledStrings(text: string): readonly Reassembly[] {
  const bindings = bindingsIn(text);
  const found: Reassembly[] = [];

  for (const match of text.matchAll(concatenation)) {
    const operands = match[0].split("+").map((operand) => operand.trim());
    const pieces = operands.map((operand) => literalValue(operand, bindings));
    if (pieces.length < 2 || pieces.some((piece) => piece === null)) {
      continue;
    }
    found.push({
      value: pieces.join(""),
      spans: [
        { start: match.index, end: match.index + match[0].length },
        ...operands.flatMap((operand) => bindingSpans(text, operand, bindings)),
      ],
    });
  }
  return found;
}

/** The string an operand stands for, or null where it stands for something this cannot read. */
function literalValue(operand: string, bindings: Bindings): string | null {
  const direct = quotedValue(operand);
  if (direct !== null) {
    return direct;
  }
  const bound = bindings.get(operand);
  return bound === undefined ? null : quotedValue(bound.trim());
}

function quotedValue(expression: string): string | null {
  const quoted = /^(['"])([^'"\n]*)\1$/.exec(expression);
  return quoted === null ? null : (quoted[2] ?? "");
}

/** Where a name's binding wrote its literal, so redacting the chain also redacts the pieces. */
function bindingSpans(
  text: string,
  operand: string,
  bindings: Bindings,
): readonly { start: number; end: number }[] {
  const bound = bindings.get(operand);
  if (bound === undefined || quotedValue(bound.trim()) === null) {
    return [];
  }
  const spans: { start: number; end: number }[] = [];
  const pattern = new RegExp(
    String.raw`\b${escaped(operand)}\s*=\s*(${escaped(bound.trim())})`,
    "g",
  );
  for (const match of text.matchAll(pattern)) {
    const literal = match[1] ?? "";
    const start = match.index + match[0].length - literal.length;
    spans.push({ start, end: start + literal.length });
  }
  return spans;
}

function escaped(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
