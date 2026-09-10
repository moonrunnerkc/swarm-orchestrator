import {
  aRunnerCouldLoadIt,
  type ChangedLines,
  carriesCode,
  namesATestFile,
} from "./oracle-reach.ts";

/**
 * Changes to the lines a patch added that an oracle worth anything has to refuse.
 *
 * Reach asks whether the oracle executed the change. This asks the harder question underneath it:
 * an oracle can execute a line and still assert nothing about it. So the line is changed into
 * something that behaves differently and the oracle is run again. One that still accepts did not
 * test what it appeared to test.
 *
 * Every operator is a syntactic rule over a line, never a rule about a repository, a patch or a
 * task: a check whose sensitivity can be tuned per subject measures the tuning.
 *
 * The equivalent-mutant problem is not solved here and is not left open either: a mutant that
 * changes nothing observable is indistinguishable from an oracle that failed to notice one that
 * did, so a second detector has to witness the change before an accepted mutant is read as a gap.
 * That lives in `mutant-witness.ts`. What this file does is keep the operators mechanical and rank
 * them by how often each produces a mutant that changes nothing, so a cost bound cuts the
 * doubtful ones first.
 *
 * The operator set is derived from the language's statement productions rather than from the
 * patches that exposed a gap in it. `docs/oracle-bond-operators.md` carries the derivation, the
 * ordering and which tasks were in sample when it was written.
 */
export type MutantOperator =
  | "invert-comparison"
  | "negate-condition"
  | "swap-arithmetic-operands"
  | "return-sentinel"
  | "replace-assigned-value"
  | "swap-call-arguments"
  | "drop-chained-call"
  | "delete-statement";

/**
 * Ordered by how often the operator produces a mutant that behaves exactly as the original did.
 * Inverting a comparison changes the predicate whatever the operands are; deleting a statement
 * changes nothing wherever that statement had no observable effect, which is the residual the
 * whole list is ordered by. Two rules never compete for one line: the first one here that fires
 * takes it, and the bound on mutants per patch cuts the tail of this list before the head.
 *
 * The three general operators are last. They are last because they are general: a rule that fires
 * on almost any statement fires on the statements that do nothing as well.
 */
const operatorsByEquivalenceRisk: readonly MutantOperator[] = [
  "invert-comparison",
  "negate-condition",
  "swap-arithmetic-operands",
  "return-sentinel",
  "replace-assigned-value",
  "swap-call-arguments",
  "drop-chained-call",
  "delete-statement",
];

export interface Mutant {
  /** File, line and operator: one name, stable across runs, that a record can cite. */
  readonly id: string;
  readonly path: string;
  /** The line as the patched file numbers it, which is the line the checkout holds. */
  readonly line: number;
  readonly operator: MutantOperator;
  readonly before: string;
  readonly after: string;
}

/**
 * String and comment contents replaced by spaces, so an operator scanning for `===` cannot find
 * one inside a message about precedence. Same length as the input, so every index a scan returns
 * still addresses the original text.
 */
function withoutLiterals(text: string): string {
  const masked = [...text];
  let quote: string | null = null;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at] ?? "";
    if (quote !== null) {
      masked[at] = " ";
      if (character === "\\") {
        masked[at + 1] = " ";
        at += 1;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      masked[at] = " ";
      continue;
    }
    if (character === "/" && (text[at + 1] === "/" || text[at + 1] === "*")) {
      for (let rest = at; rest < text.length; rest += 1) {
        masked[rest] = " ";
      }
      break;
    }
  }
  return masked.join("");
}

/**
 * Whether the whole line is prose. A block comment's continuation lines carry no `/*` of their
 * own, so masking one line at a time cannot see them, and a JSDoc paragraph about merging local
 * and global options is otherwise read as code with operators in it.
 */
function readsAsAComment(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");
}

const comparisons: readonly { readonly token: string; readonly inverse: string }[] = [
  { token: "===", inverse: "!==" },
  { token: "!==", inverse: "===" },
  { token: "==", inverse: "!=" },
  { token: "!=", inverse: "==" },
  { token: "<=", inverse: ">" },
  { token: ">=", inverse: "<" },
];

/**
 * A comparison flipped to its opposite.
 *
 * A bare `<` or `>` is only read as one where a space sits on both sides of it, which is what
 * separates `a < b` from `Map<string, number>`, from `one << two`, and from the `>` of an arrow.
 * Being wrong in the permissive direction costs one mutant; being wrong the other way rewrites a
 * type argument into a syntax error and calls the oracle's refusal of it evidence.
 */
function invertedComparison(text: string, masked: string): string | null {
  for (let at = 0; at < masked.length; at += 1) {
    for (const { token, inverse } of comparisons) {
      if (masked.startsWith(token, at)) {
        return text.slice(0, at) + inverse + text.slice(at + token.length);
      }
    }
    const character = masked[at];
    if (
      (character === "<" || character === ">") &&
      masked[at - 1] === " " &&
      masked[at + 1] === " "
    ) {
      return text.slice(0, at) + (character === "<" ? ">=" : "<=") + text.slice(at + 1);
    }
  }
  return null;
}

/**
 * How far back one operand of a binary operator reaches, or null where the text before the
 * operator is not one.
 *
 * A call is an operand as much as a name is: dayjs#2367 divides `Math.round(ms)` by 1000, and a
 * rule that only knows names leaves that patch with nothing to bond. So a trailing balanced
 * parenthesis is walked over and the name in front of it taken with it.
 */
function operandBefore(masked: string, end: number): number | null {
  let at = end;
  if (masked[at - 1] === ")") {
    let depth = 0;
    for (; at > 0; at -= 1) {
      if (masked[at - 1] === ")") depth += 1;
      if (masked[at - 1] === "(") {
        depth -= 1;
        if (depth === 0) {
          at -= 1;
          break;
        }
      }
    }
    if (depth !== 0) return null;
  }
  const start = at;
  while (at > 0 && /[A-Za-z0-9_$.]/.test(masked[at - 1] ?? "")) at -= 1;
  if (at === start) return null;
  // A unary sign in front turns the swap into arithmetic that means the same thing: `-1 - 2` and
  // `-2 - 1` are both minus three. So is a second operator, which would be a different expression
  // from the one this reads.
  return /[-+*/%<>=!&|^~]/.test(masked[at - 1] ?? "") ? null : at;
}

function operandAfter(masked: string, from: number): number | null {
  let at = from;
  while (at < masked.length && /[A-Za-z0-9_$.]/.test(masked[at] ?? "")) at += 1;
  if (at === from) return null;
  if (masked[at] === "(") {
    let depth = 0;
    for (; at < masked.length; at += 1) {
      if (masked[at] === "(") depth += 1;
      if (masked[at] === ")") {
        depth -= 1;
        if (depth === 0) {
          at += 1;
          break;
        }
      }
    }
    if (depth !== 0) return null;
  }
  return at;
}

/** `end - start` becomes `start - end`. Equal operands are left alone: swapping them is a no-op. */
function swappedArithmetic(text: string, masked: string): string | null {
  for (let at = 1; at < masked.length - 2; at += 1) {
    const operator = masked[at] ?? "";
    if (!"-/%".includes(operator) || masked[at - 1] !== " " || masked[at + 1] !== " ") {
      continue;
    }
    const leftFrom = operandBefore(masked, at - 1);
    const rightTo = operandAfter(masked, at + 2);
    if (leftFrom === null || rightTo === null) {
      continue;
    }
    const left = text.slice(leftFrom, at - 1);
    const right = text.slice(at + 2, rightTo);
    if (left === right) {
      continue;
    }
    return `${text.slice(0, leftFrom)}${right} ${operator} ${left}${text.slice(rightTo)}`;
  }
  return null;
}

/**
 * Literals whose truthiness is known from the spelling alone. A sentinel that agrees with one of
 * these on truthiness is not a sentinel: `filter` and every `if` read nothing else.
 */
const falsyLiterals = new Set([
  "false",
  "0",
  "-0",
  "0n",
  "''",
  '""',
  "``",
  "null",
  "undefined",
  "void 0",
  "NaN",
]);

/**
 * A returned expression replaced by a sentinel no caller asked for.
 *
 * The sentinel is chosen to differ from the expression wherever the expression's truthiness is
 * known: `undefined` for anything else, and a truthy string where the expression is a falsy
 * literal. Measured, not reasoned about: commander#1711 adds `return false;` inside a `filter`
 * predicate, and `return undefined;` there is the same predicate, so the oracle accepting it was
 * recorded as a gap in an oracle that had none.
 *
 * The residual this leaves: the truthiness of an expression that is not a literal is not
 * syntactically known, so `undefined` is equivalent wherever that expression was falsy at runtime
 * and the caller read only its truthiness. Beside it, the residual every operator here carries: a
 * function whose return value nothing reads behaves identically with any sentinel in place.
 */
function returnedSentinel(text: string, masked: string): string | null {
  const found = /^(\s*)return\s+(.+?);\s*$/.exec(masked);
  if (found === null) {
    return null;
  }
  const indent = found[1] ?? "";
  const returned = text.slice(indent.length + "return ".length, text.lastIndexOf(";")).trim();
  return `${indent}return ${falsyLiterals.has(returned) ? '"swarm-oracle-bond"' : "undefined"};`;
}

const callee = /(^|[^A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$.]*)\(/g;
const keywordsThatAreNotCalls = new Set(["if", "for", "while", "switch", "catch", "function"]);

/**
 * Operations whose two arguments have no order, so swapping them is not a change.
 *
 * A property of JavaScript rather than of any repository: `Math.min(a, b)` and `Math.min(b, a)`
 * are the same call. Measured, not reasoned about: a darkreader patch's `Math.min(i + size, len)`
 * was swapped, the oracle accepted the result, and that was recorded as a gap in an oracle that
 * had none.
 *
 * Matched on the last segment of the callee, so a project's own `min(a, b)` is covered too. Wrong
 * in the permissive direction only: a two-argument function of one of these names whose arguments
 * do have an order loses one mutant, which weakens the check by one line rather than refusing a
 * patch that is fine.
 */
const commutativeOperations = new Set(["min", "max", "hypot", "imul", "is"]);

/**
 * The two arguments of a call, swapped.
 *
 * A parameter list is not an argument list, so a call whose closing parenthesis is followed by a
 * block is left alone: swapping the parameters of a function the patch declares changes the
 * declaration and every call in the same patch at once, which is a different change from the one
 * this operator is for.
 */
function swappedArguments(text: string, masked: string): string | null {
  callee.lastIndex = 0;
  for (let found = callee.exec(masked); found !== null; found = callee.exec(masked)) {
    const name = found[2] ?? "";
    const before = masked.slice(0, found.index + (found[1] ?? "").length).trimEnd();
    if (
      keywordsThatAreNotCalls.has(name) ||
      commutativeOperations.has(name.split(".").at(-1) ?? "") ||
      /\bfunction$/.test(before)
    ) {
      continue;
    }
    const open = found.index + found[0].length - 1;
    const close = matchingParenthesis(masked, open);
    if (close === null || /^\s*\{/.test(masked.slice(close + 1))) {
      continue;
    }
    const commas = topLevelCommas(masked, open + 1, close);
    if (commas.length !== 1) {
      continue;
    }
    const split = commas[0] ?? 0;
    const left = text.slice(open + 1, split).trim();
    const right = text.slice(split + 1, close).trim();
    if (left.length === 0 || right.length === 0 || left === right) {
      continue;
    }
    return `${text.slice(0, open + 1)}${right}, ${left}${text.slice(close)}`;
  }
  return null;
}

/** `xs.reverse().forEach(...)` becomes `xs.forEach(...)`: the chain uses what the call returned. */
function droppedChainedCall(text: string, masked: string): string | null {
  const found = /\.[A-Za-z_$][A-Za-z0-9_$]*\(\)\./.exec(masked);
  if (found === null || found.index === undefined) {
    return null;
  }
  return `${text.slice(0, found.index)}.${text.slice(found.index + found[0].length)}`;
}

/**
 * `if` and `while` read as keywords rather than as two or five characters. A call whose name ends
 * in one, `motif(list)` or `erstwhile(all)`, would otherwise have its arguments wrapped in a
 * negation, which changes what the call is handed rather than which branch runs.
 */
const conditionHead = /(^|[^A-Za-z0-9_$.])(if|while)\s*\(/g;

/**
 * The whole condition of an `if` or a `while`, negated.
 *
 * The general rule for a guard clause, which is the shape ordinary code is mostly made of and the
 * shape the first five operators had no rule for. The whole parenthesis is wrapped rather than a
 * token inside it edited, so one rule covers `if (!this.isValid()) {`, `} else if (a && b) {` and
 * `while (queue.length) {`.
 *
 * `for` is left alone deliberately: its parenthesis holds three clauses and wrapping all of them
 * is not a condition negation.
 *
 * Equivalence residual: a condition whose two branches do the same thing.
 */
function negatedCondition(text: string, masked: string): string | null {
  conditionHead.lastIndex = 0;
  for (let found = conditionHead.exec(masked); found !== null; found = conditionHead.exec(masked)) {
    const open = found.index + found[0].length - 1;
    const close = matchingParenthesis(masked, open);
    if (close === null || text.slice(open + 1, close).trim().length === 0) {
      continue;
    }
    return `${text.slice(0, open + 1)}!(${text.slice(open + 1, close)})${text.slice(close)}`;
  }
  return null;
}

/** How deep into brackets an index sits, or null where the text up to it does not balance. */
function depthBefore(masked: string, end: number): number | null {
  let depth = 0;
  for (let at = 0; at < end; at += 1) {
    const character = masked[at] ?? "";
    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) {
      depth -= 1;
      if (depth < 0) return null;
    }
  }
  return depth;
}

/**
 * The one `=` that assigns, or null where the line has none.
 *
 * Not `==`, `===`, `!=`, `!==`, `<=`, `>=`, or the `=` of an arrow, and not a compound assignment,
 * whose operator carries the arithmetic the mutant would be throwing away. Not an `=` inside
 * brackets either: a default parameter and a destructuring default are both written with one, and
 * neither is the value the statement writes.
 */
function plainAssignment(masked: string): number | null {
  for (let at = 0; at < masked.length; at += 1) {
    if (masked[at] !== "=" || masked[at + 1] === "=" || masked[at + 1] === ">") {
      continue;
    }
    if (/[=!<>+\-*/%&|^?:]/.test(masked[at - 1] ?? "")) {
      continue;
    }
    if (depthBefore(masked, at) !== 0) {
      continue;
    }
    return at;
  }
  return null;
}

/**
 * The value a plain assignment or a declaration writes, replaced by a sentinel nobody asked for.
 *
 * The shape `return-sentinel` covers one statement over from, and the second most common thing an
 * added line is after a call. The sentinel is chosen the way that operator chooses it, and for the
 * reason it was narrowed: one that agrees with what it replaces on truthiness is not a sentinel.
 *
 * Only where the line is a complete statement, because an assignment whose value opens an object
 * literal continues on the lines below and replacing the opening leaves them orphaned.
 *
 * Equivalence residual: an assignment nothing reads.
 */
function replacedAssignedValue(text: string, masked: string): string | null {
  if (!looksLikeACompleteStatement(masked)) {
    return null;
  }
  const at = plainAssignment(masked);
  if (at === null || masked.slice(0, at).trim().length === 0) {
    return null;
  }
  const raw = text.slice(at + 1);
  const terminator = /(\s*;?\s*)$/.exec(raw)?.[1] ?? "";
  const written = raw.slice(0, raw.length - terminator.length).trim();
  if (written.length === 0) {
    return null;
  }
  const sentinel = falsyLiterals.has(written) ? '"swarm-oracle-bond"' : "undefined";
  return `${text.slice(0, at + 1)} ${sentinel}${terminator}`;
}

/** Keywords whose line is the head of a block below it, so the line is not a statement of its own. */
const keywordsNeedingTheirBlock = new Set([
  "else",
  "case",
  "default",
  "catch",
  "finally",
  "do",
  "try",
  "switch",
]);

/** A line that ends here is waiting for the next one. */
const endsUnfinished = /[+\-*/%&|^<>=!?:,({[]$/;

/** A line that starts here is finishing the one before it. */
const startsUnfinished = /^(\?\.|[.,:)\]}+\-*/%&|^<>=!?])/;

/**
 * Whether the line reads as a whole statement, read lexically because there is no parser here.
 *
 * Balanced brackets that never go negative, an end that is not waiting for the next line, a start
 * that is not finishing the last one, and no keyword whose block sits below it. This is a
 * sufficiency test rather than a decision: it is wrong only in the direction of proposing a
 * deletion that does not parse, and `mutantParses` refuses those before they are used as evidence.
 */
function looksLikeACompleteStatement(masked: string): boolean {
  const trimmed = masked.trim();
  if (trimmed.length === 0 || endsUnfinished.test(trimmed) || startsUnfinished.test(trimmed)) {
    return false;
  }
  if (keywordsNeedingTheirBlock.has(/^[A-Za-z_$][A-Za-z0-9_$]*/.exec(trimmed)?.[0] ?? "")) {
    return false;
  }
  return depthBefore(masked, masked.length) === 0;
}

/**
 * The statement removed.
 *
 * The most general operator there is: almost any complete statement can be taken out, and a test
 * that asserts on what it did will notice. It is last in the ordering for the same reason, since a
 * rule that fires on almost any statement fires on the ones that do nothing too.
 *
 * Blanked rather than removed, so every line below it keeps its number. The coverage hit map the
 * bond reads is keyed by line, and a mutant that renumbers the file is a mutant nothing can be
 * shown to have run.
 */
function deletedStatement(_text: string, masked: string): string | null {
  return looksLikeACompleteStatement(masked) ? "" : null;
}

function matchingParenthesis(masked: string, open: number): number | null {
  let depth = 0;
  for (let at = open; at < masked.length; at += 1) {
    if (masked[at] === "(") depth += 1;
    if (masked[at] === ")") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return null;
}

function topLevelCommas(masked: string, from: number, to: number): readonly number[] {
  const found: number[] = [];
  let depth = 0;
  for (let at = from; at < to; at += 1) {
    const character = masked[at];
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") depth -= 1;
    if (character === "," && depth === 0) found.push(at);
  }
  return found;
}

const mutateBy: Readonly<Record<MutantOperator, (text: string, masked: string) => string | null>> =
  {
    "invert-comparison": invertedComparison,
    "negate-condition": negatedCondition,
    "swap-arithmetic-operands": swappedArithmetic,
    "return-sentinel": returnedSentinel,
    "replace-assigned-value": replacedAssignedValue,
    "swap-call-arguments": swappedArguments,
    "drop-chained-call": droppedChainedCall,
    "delete-statement": deletedStatement,
  };

/**
 * The one mutant a line is worth, or null.
 *
 * One per line rather than one per operator, because two mutants of the same line cannot both be
 * applied and running them one at a time doubles the oracle runs for the second-best rule on a
 * line the first rule already covered.
 */
function mutantOfLine(path: string, line: number, text: string): Mutant | null {
  // A line with no behaviour on it has no behaviour to change, read off reach's own definition
  // rather than a second spelling of it.
  if (readsAsAComment(text) || !carriesCode(text)) {
    return null;
  }
  const masked = withoutLiterals(text);
  for (const operator of operatorsByEquivalenceRisk) {
    const after = mutateBy[operator](text, masked);
    if (after !== null && after !== text) {
      return { id: `${path}:${line}:${operator}`, path, line, operator, before: text, after };
    }
  }
  return null;
}

export interface MutantPlan {
  readonly changed: readonly ChangedLines[];
  /** Total mutants to build. Each one is another oracle run, which is what the bound is for. */
  readonly limit?: number;
  /** Mutants one operator may contribute, so a patch full of comparisons still gets variety. */
  readonly perOperatorLimit?: number;
}

export function mutantsOfChangedLines(plan: MutantPlan): readonly Mutant[] {
  const limit = plan.limit ?? 6;
  const perOperatorLimit = plan.perOperatorLimit ?? 2;
  const candidates: { readonly rank: number; readonly order: number; readonly mutant: Mutant }[] =
    [];

  for (const [fileAt, file] of plan.changed.entries()) {
    // The same two exclusions reach applies, for the same reasons: an acceptance oracle runs its
    // own test file and never the candidate's, and a file no runner loads has no behaviour to
    // change. A mutant in either could only be refused for a reason that is not about the patch.
    if (namesATestFile(file.path) || !aRunnerCouldLoadIt(file.path)) {
      continue;
    }
    for (const added of file.addedLines) {
      const mutant = mutantOfLine(file.path, added.line, added.text);
      if (mutant === null) {
        continue;
      }
      candidates.push({
        rank: operatorsByEquivalenceRisk.indexOf(mutant.operator),
        order: fileAt * 1_000_000 + added.line,
        mutant,
      });
    }
  }

  const chosen = new Set<string>();
  const perOperator = new Map<MutantOperator, number>();
  for (const candidate of [...candidates].sort(
    (one, other) => one.rank - other.rank || one.order - other.order,
  )) {
    if (chosen.size >= limit) break;
    const taken = perOperator.get(candidate.mutant.operator) ?? 0;
    if (taken >= perOperatorLimit) continue;
    perOperator.set(candidate.mutant.operator, taken + 1);
    chosen.add(candidate.mutant.id);
  }

  return candidates
    .filter((candidate) => chosen.has(candidate.mutant.id))
    .sort((one, other) => one.order - other.order)
    .map((candidate) => candidate.mutant);
}
