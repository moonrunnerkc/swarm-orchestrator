/**
 * Structural refusal of search patterns that can backtrack super-linearly.
 *
 * A search pattern is model output, and `RegExp.prototype.test` runs on the main thread
 * with no step budget: `(a+)+$` against thirty characters already takes seconds, and V8
 * offers no way to interrupt a match once it starts. The bound therefore has to be decided
 * before the pattern runs, by reading its structure.
 *
 * What makes a failing match explode is ambiguity: more than one way for the pattern to
 * carve up the same text, so a failure at the end has to be retried against every carving.
 * Three shapes produce it, and each is refused here:
 *   - a variable-length quantifier inside another quantifier: `(a+)+`, `(\w+\s)*`
 *   - a repeated body that can also match nothing: `(a?)+`, `(a|)*`
 *   - two variable quantifiers competing for the same character, side by side or as
 *     alternatives under one quantifier: `\s*\s*$`, `(a|ab)+`, `(\w|\d)+`
 *
 * This is known-shape refusal, not a proof of linear time, and it is conservative in both
 * directions. It refuses patterns that would have run fast, and it does not see ambiguity
 * introduced by a backreference or buried several levels under a quantifier (`((a|ab)y)+`).
 * A pattern the parser below cannot read is refused rather than run, since an unread
 * pattern is one nothing bounds.
 */

/** Why a pattern was refused, phrased so the caller can rewrite it. */
export interface BacktrackingRisk {
  readonly reason: string;
  /** The sub-pattern carrying the risk, so the message points at something concrete. */
  readonly construct: string;
}

export function findBacktrackingRisk(pattern: string): BacktrackingRisk | null {
  let parsed: PatternNode;
  try {
    parsed = parsePattern(pattern);
  } catch (cause) {
    return {
      reason: `could not be read structurally (${describeCause(cause)}), so nothing bounds how it backtracks`,
      construct: pattern,
    };
  }
  return inspect(parsed, null, pattern);
}

interface Span {
  readonly start: number;
  readonly end: number;
}

type PatternNode =
  | (Span & { readonly kind: "alternation"; readonly branches: readonly PatternNode[] })
  | (Span & { readonly kind: "sequence"; readonly terms: readonly PatternNode[] })
  | RepeatNode
  | (Span & { readonly kind: "group"; readonly body: PatternNode })
  | (Span & { readonly kind: "lookaround"; readonly body: PatternNode })
  | (Span & { readonly kind: "character"; readonly source: string })
  | (Span & { readonly kind: "zeroWidth"; readonly source: string })
  | (Span & { readonly kind: "backreference"; readonly source: string });

interface RepeatNode extends Span {
  readonly kind: "repeat";
  readonly body: PatternNode;
  readonly min: number;
  readonly max: number;
}

class PatternUnreadableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PatternUnreadableError";
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// The walk: every rule below needs the enclosing repeat, not just a depth, so a refusal
// can quote the whole construct rather than the fragment that tripped it.

function inspect(
  node: PatternNode,
  enclosingRepeat: RepeatNode | null,
  source: string,
): BacktrackingRisk | null {
  switch (node.kind) {
    case "alternation": {
      const competing = repeatedAlternativesRisk(node.branches, enclosingRepeat, source);
      return (
        competing ?? firstRisk(node.branches, (branch) => inspect(branch, enclosingRepeat, source))
      );
    }
    case "sequence": {
      const competing = findCompetingNeighbours(node.terms, source);
      return competing ?? firstRisk(node.terms, (term) => inspect(term, enclosingRepeat, source));
    }
    case "repeat": {
      if (!repeatsMoreThanOnce(node)) {
        return inspect(node.body, enclosingRepeat, source);
      }
      const risk = repeatRisk(node, enclosingRepeat, source);
      return risk ?? inspect(node.body, node, source);
    }
    case "group":
      return inspect(node.body, enclosingRepeat, source);
    case "lookaround":
      // A lookaround consumes nothing, so no enclosing quantifier can pump what is inside
      // it. Its own contents are still read on their own terms.
      return inspect(node.body, null, source);
    default:
      return null;
  }
}

function repeatRisk(
  repeat: RepeatNode,
  enclosingRepeat: RepeatNode | null,
  source: string,
): BacktrackingRisk | null {
  // A body that consumes nothing cannot be pumped: the engine stops the loop on the first
  // empty iteration, so no amount of repetition multiplies the work.
  if (!consumesCharacters(repeat.body)) {
    return null;
  }

  if (enclosingRepeat !== null && varyingLength(repeat)) {
    return {
      reason:
        "repeats a variable-length quantifier inside another quantifier, so one input has exponentially many ways to be split between them",
      construct: quote(enclosingRepeat, source),
    };
  }

  if (matchesEmpty(repeat.body)) {
    return {
      reason:
        "repeats a body that can also match nothing, so each iteration has two ways to cover the same position",
      construct: quote(repeat, source),
    };
  }

  return null;
}

/**
 * Alternatives that can both match at the same position are decided by trying one and
 * coming back for the other, and a quantifier around them multiplies that choice by every
 * iteration: `(a|ab)+` has to try every way to cut the input into `a` and `ab` pieces.
 */
function repeatedAlternativesRisk(
  branches: readonly PatternNode[],
  enclosingRepeat: RepeatNode | null,
  source: string,
): BacktrackingRisk | null {
  if (enclosingRepeat === null) {
    return null;
  }
  const competing = findCompetingAlternatives(branches);
  if (competing === null) {
    return null;
  }
  return {
    reason: `repeats alternatives that can both match at the same position (${competing}), so the same text can be carved up more than one way`,
    construct: quote(enclosingRepeat, source),
  };
}

/**
 * Two variable quantifiers reachable from one another over nullable terms both compete for
 * the run of characters between them: `\s*\s*$` retries every split of that run. The scan
 * stops at the first term that must consume something, since that term pins the boundary.
 */
function findCompetingNeighbours(
  terms: readonly PatternNode[],
  source: string,
): BacktrackingRisk | null {
  for (const [index, left] of terms.entries()) {
    if (left.kind !== "repeat" || !varyingLength(left) || !consumesCharacters(left.body)) {
      continue;
    }
    for (const right of terms.slice(index + 1)) {
      if (
        right.kind === "repeat" &&
        varyingLength(right) &&
        consumesCharacters(right.body) &&
        charactersOverlap(leadingCharacters(left.body), leadingCharacters(right.body))
      ) {
        return {
          reason:
            "puts two variable quantifiers over the same characters in sequence, so every split of a run between them is retried",
          construct: `${quote(left, source)}${quote(right, source)}`,
        };
      }
      if (!matchesEmpty(right)) {
        break;
      }
    }
  }
  return null;
}

function findCompetingAlternatives(branches: readonly PatternNode[]): string | null {
  for (const [index, left] of branches.entries()) {
    for (const right of branches.slice(index + 1)) {
      if (alternativesCompete(left, right)) {
        return `${describeBranch(left)} and ${describeBranch(right)}`;
      }
    }
  }
  return null;
}

/**
 * Distinct literals that are not prefixes of one another decide themselves on the first
 * character that differs, so `(get|got)+` is unambiguous. Anything else falls back to
 * asking whether the two branches can start on the same character.
 */
function alternativesCompete(left: PatternNode, right: PatternNode): boolean {
  const leftLiteral = literalText(left);
  const rightLiteral = literalText(right);
  if (leftLiteral !== null && rightLiteral !== null) {
    return leftLiteral.startsWith(rightLiteral) || rightLiteral.startsWith(leftLiteral);
  }
  return charactersOverlap(leadingCharacters(left), leadingCharacters(right));
}

function describeBranch(node: PatternNode): string {
  const literal = literalText(node);
  return literal === null ? leadingCharacters(node).join("") : literal;
}

// Shape questions the rules ask of a node.

function repeatsMoreThanOnce(repeat: RepeatNode): boolean {
  return repeat.max >= 2;
}

function varyingLength(repeat: RepeatNode): boolean {
  return repeat.max > repeat.min || varyingBodyLength(repeat.body);
}

function varyingBodyLength(node: PatternNode): boolean {
  switch (node.kind) {
    case "alternation":
      return node.branches.some(varyingBodyLength) || !allBranchesFixedWidth(node.branches);
    case "sequence":
      return node.terms.some(varyingBodyLength);
    case "repeat":
      return node.max > node.min || varyingBodyLength(node.body);
    case "group":
      return varyingBodyLength(node.body);
    case "backreference":
      return true;
    default:
      return false;
  }
}

function allBranchesFixedWidth(branches: readonly PatternNode[]): boolean {
  const widths = new Set(branches.map((branch) => literalText(branch)?.length ?? -1));
  return widths.size === 1 && !widths.has(-1);
}

function consumesCharacters(node: PatternNode): boolean {
  switch (node.kind) {
    case "alternation":
      return node.branches.some(consumesCharacters);
    case "sequence":
      return node.terms.some(consumesCharacters);
    case "repeat":
      return node.max >= 1 && consumesCharacters(node.body);
    case "group":
      return consumesCharacters(node.body);
    case "character":
      return true;
    default:
      return false;
  }
}

function matchesEmpty(node: PatternNode): boolean {
  switch (node.kind) {
    case "alternation":
      return node.branches.some(matchesEmpty);
    case "sequence":
      return node.terms.every(matchesEmpty);
    case "repeat":
      return node.min === 0 || matchesEmpty(node.body);
    case "group":
      return matchesEmpty(node.body);
    case "character":
      return false;
    default:
      // Anchors, lookarounds and backreferences can all cover a position without consuming it.
      return true;
  }
}

/** The exact text a node must match, when it is one, or null when it can vary. */
function literalText(node: PatternNode): string | null {
  switch (node.kind) {
    case "character":
      return node.source.length === 1 && node.source !== "." ? node.source : null;
    case "sequence": {
      const parts = node.terms.map(literalText);
      return parts.every((part) => part !== null) ? parts.join("") : null;
    }
    case "group":
      return literalText(node.body);
    default:
      return null;
  }
}

/** Sources of the single-character atoms a match here can begin with. */
function leadingCharacters(node: PatternNode): readonly string[] {
  switch (node.kind) {
    case "alternation":
      return node.branches.flatMap(leadingCharacters);
    case "sequence": {
      const leading: string[] = [];
      for (const term of node.terms) {
        leading.push(...leadingCharacters(term));
        if (!matchesEmpty(term)) {
          break;
        }
      }
      return leading;
    }
    case "repeat":
      return node.max === 0 ? [] : leadingCharacters(node.body);
    case "group":
      return leadingCharacters(node.body);
    case "character":
      return [node.source];
    default:
      return [];
  }
}

/**
 * Whether two atoms can match one and the same character. Decided by probing, over an
 * alphabet rather than by set algebra: each atom is a single character matcher, so
 * compiling it costs nothing and can itself never backtrack.
 */
function charactersOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((leftAtom) =>
    right.some((rightAtom) => {
      const leftMatches = probeMatches(leftAtom);
      return probeMatches(rightAtom).some((probe) => leftMatches.includes(probe));
    }),
  );
}

const probeAlphabet: readonly string[] = [
  ...Array.from({ length: 95 }, (_, offset) => String.fromCharCode(32 + offset)),
  "\n",
  "\r",
  "\t",
  "é",
  "中",
];

const probeCache = new Map<string, readonly string[]>();

function probeMatches(atomSource: string): readonly string[] {
  const cached = probeCache.get(atomSource);
  if (cached !== undefined) {
    return cached;
  }
  let matched: readonly string[];
  try {
    const atom = new RegExp(`^(?:${atomSource})$`);
    matched = probeAlphabet.filter((probe) => atom.test(probe));
  } catch {
    matched = [];
  }
  probeCache.set(atomSource, matched);
  return matched;
}

function firstRisk(
  nodes: readonly PatternNode[],
  check: (node: PatternNode) => BacktrackingRisk | null,
): BacktrackingRisk | null {
  for (const node of nodes) {
    const risk = check(node);
    if (risk !== null) {
      return risk;
    }
  }
  return null;
}

function quote(node: PatternNode, source: string): string {
  return source.slice(node.start, node.end);
}

// The parser: enough of the JavaScript pattern grammar to see quantifier nesting and
// single-character atoms. Anything it does not recognise raises, and the caller refuses.

interface Cursor {
  readonly source: string;
  index: number;
}

function parsePattern(source: string): PatternNode {
  const cursor: Cursor = { source, index: 0 };
  const parsed = parseAlternation(cursor);
  if (cursor.index !== source.length) {
    throw new PatternUnreadableError(`unexpected "${source[cursor.index] ?? ""}"`);
  }
  return parsed;
}

function parseAlternation(cursor: Cursor): PatternNode {
  const start = cursor.index;
  const branches = [parseSequence(cursor)];
  while (cursor.source[cursor.index] === "|") {
    cursor.index += 1;
    branches.push(parseSequence(cursor));
  }
  const only = branches[0];
  if (branches.length === 1 && only !== undefined) {
    return only;
  }
  return { kind: "alternation", branches, start, end: cursor.index };
}

function parseSequence(cursor: Cursor): PatternNode {
  const start = cursor.index;
  const terms: PatternNode[] = [];
  while (cursor.index < cursor.source.length) {
    const char = cursor.source[cursor.index];
    if (char === "|" || char === ")") {
      break;
    }
    terms.push(parseTerm(cursor));
  }
  const only = terms[0];
  if (terms.length === 1 && only !== undefined) {
    return only;
  }
  return { kind: "sequence", terms, start, end: cursor.index };
}

function parseTerm(cursor: Cursor): PatternNode {
  const start = cursor.index;
  const body = parseAtom(cursor);
  const bounds = parseQuantifier(cursor);
  if (bounds === null) {
    return body;
  }
  // A lazy quantifier backtracks over the same splits, just in the other order.
  if (cursor.source[cursor.index] === "?") {
    cursor.index += 1;
  }
  return { kind: "repeat", body, min: bounds.min, max: bounds.max, start, end: cursor.index };
}

const quantifierBounds = /^\{(\d+)(,(\d+)?)?\}/;

function parseQuantifier(cursor: Cursor): { min: number; max: number } | null {
  const char = cursor.source[cursor.index];
  if (char === "*") {
    cursor.index += 1;
    return { min: 0, max: Number.POSITIVE_INFINITY };
  }
  if (char === "+") {
    cursor.index += 1;
    return { min: 1, max: Number.POSITIVE_INFINITY };
  }
  if (char === "?") {
    cursor.index += 1;
    return { min: 0, max: 1 };
  }
  if (char !== "{") {
    return null;
  }
  const braced = quantifierBounds.exec(cursor.source.slice(cursor.index));
  const lower = braced?.[1];
  if (braced === null || lower === undefined) {
    // Not a quantifier at all: an unmatched "{" is a literal brace.
    return null;
  }
  cursor.index += braced[0].length;
  const min = Number(lower);
  if (braced[2] === undefined) {
    return { min, max: min };
  }
  const upper = braced[3];
  return { min, max: upper === undefined ? Number.POSITIVE_INFINITY : Number(upper) };
}

function parseAtom(cursor: Cursor): PatternNode {
  const start = cursor.index;
  const char = cursor.source[cursor.index];
  if (char === "(") {
    return parseGroup(cursor);
  }
  if (char === "[") {
    return parseCharacterClass(cursor);
  }
  if (char === "\\") {
    return parseEscape(cursor);
  }
  if (char === undefined) {
    throw new PatternUnreadableError("pattern ends where an expression was expected");
  }
  cursor.index += 1;
  const kind = char === "^" || char === "$" ? "zeroWidth" : "character";
  return { kind, source: char, start, end: cursor.index };
}

function parseGroup(cursor: Cursor): PatternNode {
  const start = cursor.index;
  cursor.index += 1;
  const kind = parseGroupPrefix(cursor);
  const body = parseAlternation(cursor);
  if (cursor.source[cursor.index] !== ")") {
    throw new PatternUnreadableError("unbalanced parenthesis");
  }
  cursor.index += 1;
  return { kind, body, start, end: cursor.index };
}

function parseGroupPrefix(cursor: Cursor): "group" | "lookaround" {
  if (cursor.source[cursor.index] !== "?") {
    return "group";
  }
  const marker = cursor.source[cursor.index + 1];
  if (marker === ":") {
    cursor.index += 2;
    return "group";
  }
  if (marker === "=" || marker === "!") {
    cursor.index += 2;
    return "lookaround";
  }
  if (marker === "<") {
    const behind = cursor.source[cursor.index + 2];
    if (behind === "=" || behind === "!") {
      cursor.index += 3;
      return "lookaround";
    }
    const closed = cursor.source.indexOf(">", cursor.index + 2);
    if (closed === -1) {
      throw new PatternUnreadableError("unterminated group name");
    }
    cursor.index = closed + 1;
    return "group";
  }
  throw new PatternUnreadableError(`unsupported group prefix "(?${marker ?? ""}"`);
}

function parseCharacterClass(cursor: Cursor): PatternNode {
  const start = cursor.index;
  cursor.index += 1;
  if (cursor.source[cursor.index] === "^") {
    cursor.index += 1;
  }
  while (cursor.index < cursor.source.length) {
    const char = cursor.source[cursor.index];
    if (char === "\\") {
      cursor.index += 2;
      continue;
    }
    cursor.index += 1;
    if (char === "]") {
      return {
        kind: "character",
        source: cursor.source.slice(start, cursor.index),
        start,
        end: cursor.index,
      };
    }
  }
  throw new PatternUnreadableError("unterminated character class");
}

function parseEscape(cursor: Cursor): PatternNode {
  const start = cursor.index;
  cursor.index += 1;
  const marker = cursor.source[cursor.index];
  if (marker === undefined) {
    throw new PatternUnreadableError("pattern ends with a backslash");
  }
  cursor.index += 1;

  if (marker === "b" || marker === "B") {
    return { kind: "zeroWidth", source: `\\${marker}`, start, end: cursor.index };
  }
  if (marker >= "1" && marker <= "9") {
    while (isDigit(cursor.source[cursor.index])) {
      cursor.index += 1;
    }
    return backreferenceFrom(cursor, start);
  }
  if (marker === "k" && cursor.source[cursor.index] === "<") {
    const closed = cursor.source.indexOf(">", cursor.index);
    if (closed === -1) {
      throw new PatternUnreadableError("unterminated backreference name");
    }
    cursor.index = closed + 1;
    return backreferenceFrom(cursor, start);
  }

  consumeEscapeArgument(cursor, marker);
  return {
    kind: "character",
    source: cursor.source.slice(start, cursor.index),
    start,
    end: cursor.index,
  };
}

function backreferenceFrom(cursor: Cursor, start: number): PatternNode {
  return {
    kind: "backreference",
    source: cursor.source.slice(start, cursor.index),
    start,
    end: cursor.index,
  };
}

function consumeEscapeArgument(cursor: Cursor, marker: string): void {
  const braced = marker === "u" || marker === "p" || marker === "P";
  if (braced && cursor.source[cursor.index] === "{") {
    const closed = cursor.source.indexOf("}", cursor.index);
    if (closed === -1) {
      throw new PatternUnreadableError("unterminated escape");
    }
    cursor.index = closed + 1;
    return;
  }
  const digits = marker === "u" ? 4 : marker === "x" ? 2 : marker === "c" ? 1 : 0;
  cursor.index = Math.min(cursor.index + digits, cursor.source.length);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}
