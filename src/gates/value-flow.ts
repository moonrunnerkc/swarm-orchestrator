/**
 * Values followed across the assignments of one changed region, so a check can ask what an
 * expression is rather than only what it says.
 *
 * Two of the gaps build-guide section 7.1 carries defeat per-line matching in the same way. A
 * comparison whose two sides are one value, written under two names, reads as an assertion on
 * either line taken alone. A credential split into halves and rejoined reads as two short
 * strings and a concatenation. In both, the thing worth seeing only exists once the names are
 * substituted, and neither needs a judge to see it: substitution is arithmetic.
 *
 * Deliberately not a parser. This reads assignments of a shape that has one meaning, and
 * anything it cannot read is left alone, because the failure mode of guessing here is a check
 * that rejects honest work. A name assigned twice is dropped rather than resolved to its last
 * value, since which assignment reaches a use is control flow, and control flow is where a
 * reader of straight-line text stops being right.
 */

/** A name bound once in the region, with the text it was bound to. */
export type ValueBindings = ReadonlyMap<string, string>;

const identifier = "[A-Za-z_$][A-Za-z0-9_$]*";

/**
 * `const name = <expression>;` and the let and var spellings of it, one per line. A
 * destructuring pattern, an assignment without a declaration, and anything spanning lines are
 * all left unread: each has more than one reading, and a wrong one is a false positive.
 */
const simpleBinding = new RegExp(
  String.raw`^\s*(?:export\s+)?(?:const|let|var)\s+(${identifier})\s*=\s*(.+?)\s*;?\s*$`,
);

/**
 * Anything that gives a value a name, which is a wider question than what can be substituted.
 * A declaration, a bare assignment, and an object property all label the value beside them,
 * and a check that judges the value needs the label to judge it by.
 *
 * Permissive on purpose, and safe to be: nothing here decides anything. What it produces is a
 * name and an expression handed to a detector that was already deciding about that pair, so a
 * name read loosely can only ever ask a question that was already being asked.
 */
const namedAssignment = new RegExp(
  String.raw`^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?(${identifier})\s*[=:]\s*(.+?)\s*[,;]?\s*$`,
);

export interface NamedValue {
  readonly name: string;
  readonly expression: string;
}

/** Every name-to-expression pair the text spells out, in order. */
export function assignmentsIn(text: string): readonly NamedValue[] {
  const found: NamedValue[] = [];
  for (const line of text.split("\n")) {
    const match = namedAssignment.exec(line);
    const name = match?.[1];
    const expression = match?.[2];
    if (name !== undefined && expression !== undefined) {
      found.push({ name, expression });
    }
  }
  return found;
}

/**
 * Names bound exactly once in the text, to the expressions they were bound to. A name bound
 * more than once is absent: two bindings mean the value at a use depends on which one reached
 * it, and this reads text rather than following control flow.
 */
export function bindingsIn(text: string): ValueBindings {
  const seen = new Map<string, string>();
  const rebound = new Set<string>();

  for (const line of text.split("\n")) {
    const match = simpleBinding.exec(line);
    const name = match?.[1];
    const value = match?.[2];
    if (name === undefined || value === undefined) {
      continue;
    }
    if (seen.has(name)) {
      rebound.add(name);
      continue;
    }
    seen.set(name, value);
  }

  for (const name of rebound) {
    seen.delete(name);
  }
  return seen;
}

/** Bounded, because a binding that refers to itself would otherwise substitute for ever. */
const substitutionDepth = 4;

/**
 * An expression with its bound names replaced by what they were bound to, repeatedly, until
 * nothing more resolves. Whitespace is folded at the end so two spellings of one expression
 * compare equal; nothing else about the text is changed, because rewriting an expression is
 * the step where a reader starts deciding what it meant.
 */
export function substituted(expression: string, bindings: ValueBindings): string {
  let current = expression;
  for (let depth = 0; depth < substitutionDepth; depth += 1) {
    const next = current.replaceAll(
      new RegExp(String.raw`(^|[^.\w$])(${identifier})\b`, "g"),
      (whole, lead: string, name: string) => {
        const bound = bindings.get(name);
        return bound === undefined ? whole : `${lead}(${bound})`;
      },
    );
    if (next === current) {
      break;
    }
    current = next;
  }
  return normalizeSpacing(current);
}

/**
 * Spacing and redundant grouping folded away, so `(v0.a)` and `v0.a` are one expression.
 * Whitespace inside a quoted string is kept: that is part of the value rather than part of how
 * the expression was written, and folding it would report a string nobody wrote.
 */
function normalizeSpacing(expression: string): string {
  let folded = stripSpacingOutsideQuotes(expression);
  for (;;) {
    const unwrapped = unwrapOuterParentheses(folded);
    if (unwrapped === folded) {
      return folded;
    }
    folded = unwrapped;
  }
}

function stripSpacingOutsideQuotes(expression: string): string {
  let stripped = "";
  let quote: string | null = null;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index] ?? "";
    if (quote !== null) {
      stripped += character;
      if (character === "\\") {
        stripped += expression[index + 1] ?? "";
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      stripped += character;
      continue;
    }
    if (!/\s/.test(character)) {
      stripped += character;
    }
  }
  return stripped;
}

function unwrapOuterParentheses(expression: string): string {
  if (!expression.startsWith("(") || !expression.endsWith(")")) {
    return expression;
  }
  let depth = 0;
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === "(") {
      depth += 1;
    } else if (expression[index] === ")") {
      depth -= 1;
      // The opening parenthesis closed before the end, so the pair is not the whole expression.
      if (depth === 0 && index < expression.length - 1) {
        return expression;
      }
    }
  }
  return expression.slice(1, -1);
}

/**
 * The string pieces a concatenation is made of, in order, or null where the expression is not
 * one. Both spellings that a rejoin uses are read: `a + b` and a template literal.
 *
 * Only pieces that resolve to string literals are returned. A concatenation carrying a call or
 * a computed value produces something this cannot know, and reporting a partial join as the
 * whole value would be reporting a value that never existed.
 */
export function concatenatedLiteral(expression: string, bindings: ValueBindings): string | null {
  const resolved = substituted(expression, bindings);
  const template = /^`([^`]*)`$/.exec(resolved);
  if (template?.[1] !== undefined) {
    return joinTemplate(template[1]);
  }
  return joinAddition(resolved);
}

/** `${(...)}` holes and literal text, where every hole resolved to a string literal. */
function joinTemplate(body: string): string | null {
  const pieces: string[] = [];
  let index = 0;
  while (index < body.length) {
    const hole = body.indexOf("${", index);
    if (hole === -1) {
      pieces.push(body.slice(index));
      break;
    }
    pieces.push(body.slice(index, hole));
    const close = matchingBrace(body, hole + 1);
    if (close === -1) {
      return null;
    }
    const piece = stringLiteral(body.slice(hole + 2, close));
    if (piece === null) {
      return null;
    }
    pieces.push(piece);
    index = close + 1;
  }
  return pieces.join("");
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** `"a" + "b" + "c"`, split at the plus signs that sit outside every quote and bracket. */
function joinAddition(expression: string): string | null {
  const pieces = splitTopLevelPlus(expression);
  if (pieces.length < 2) {
    return null;
  }
  const joined: string[] = [];
  for (const piece of pieces) {
    const literal = stringLiteral(piece);
    if (literal === null) {
      return null;
    }
    joined.push(literal);
  }
  return joined.join("");
}

function splitTopLevelPlus(expression: string): readonly string[] {
  const pieces: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (quote !== null) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (character === "+" && depth === 0) {
      pieces.push(expression.slice(start, index));
      start = index + 1;
    }
  }
  pieces.push(expression.slice(start));
  return pieces;
}

/** The contents of a quoted string, or null for anything that is not exactly one. */
function stringLiteral(piece: string): string | null {
  // Substitution wraps what it replaced in parentheses, so a piece that came from a binding
  // arrives grouped. Unwrapping is undoing this module's own step, not reading past syntax.
  let trimmed = piece.trim();
  for (;;) {
    const unwrapped = unwrapOuterParentheses(trimmed).trim();
    if (unwrapped === trimmed) {
      break;
    }
    trimmed = unwrapped;
  }
  const quoted = /^(["'`])(.*)\1$/s.exec(trimmed);
  const body = quoted?.[2];
  if (body === undefined || /["'`]/.test(body)) {
    return null;
  }
  return body;
}
