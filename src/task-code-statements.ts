/**
 * Examples and relations the task writes as code, read without a model (task-code-v1).
 *
 * A task that says `withQuery("/x?bar", {}) stays "/x?bar"` or `filterQuery(input, () => true)
 * equals withQuery(input, {}) for every input that contains "?"` has stated an executable
 * expectation in its own words. Nothing about it is a model's reading: the call is the task's
 * text, the expected answer is the task's literal or what an existing function the task names
 * returns. So the harness can run it, and a candidate that answers otherwise has a counterexample
 * whose every part is the task's.
 *
 * This reads only what is written as code: a call to a bare name, its balanced arguments, a verb,
 * and a literal or a second call. Prose ("the predicate is called once for each key") is not read
 * here; a reviewer may propose a probe for it, which stays the reviewer's. What is read is kept
 * apart by role:
 * - **requested**: `call is literal` (also returns, gives, equals, becomes, yields);
 * - **preserve**: `call stays literal` or `still returns`, or a plain verb in a sentence of keep
 *   wording ("What must not change: ...");
 * - **base**: `today call returns literal`, the behaviour the task describes as current. It is
 *   not held of the candidate, which is often asked to change it;
 * - **relation**: `call equals call`, over one free name, with the domain the sentence states. A
 *   domain this reader cannot follow ("for every valid URL") is kept but marked unfollowed.
 *
 * The literal is a string, number, boolean or null. An array or object literal is left unread
 * rather than parsed loosely.
 */
export const taskCodeRule = "task-code-v1";

export type TaskExampleRole = "requested" | "preserve" | "base";

export interface TaskExample {
  readonly kind: "example";
  readonly id: string;
  readonly role: TaskExampleRole;
  /** The sentence the example is written in, as the task gives it. */
  readonly sentence: string;
  /** The call, verbatim. */
  readonly call: string;
  /** The names the call reaches: the function, and any other bare names it calls. */
  readonly names: readonly string[];
  readonly expected: string | number | boolean | null;
}

export interface TaskRelation {
  readonly kind: "relation";
  readonly id: string;
  readonly sentence: string;
  /** The call whose answer is held to the other's, verbatim: the one the task is about. */
  readonly subject: string;
  /** The call whose answer is the expectation, verbatim. */
  readonly reference: string;
  readonly subjectName: string;
  readonly referenceName: string;
  /** The one free name both calls take, which each input is bound to. */
  readonly variable: string;
  /**
   * The domain the sentence states, where this reader follows it: the input must contain this
   * text. Null where the sentence states none. `unfollowed` where it states one this reader
   * cannot apply, which leaves every reading of the relation provisional.
   */
  readonly domain: { readonly contains: string } | null | "unfollowed";
  /** Inputs from the task's own literals, in the free name's position of its calls. */
  readonly inputs: readonly string[];
}

export type TaskCodeStatement = TaskExample | TaskRelation;

const requestedVerb =
  /^(?:is|returns|gives|equals|becomes|yields|evaluates to|must (?:return|give|be)|should (?:return|give|be)|===?|->|\u2192)\s+/;
const preserveVerb =
  /^(?:stays|remains|still (?:returns|gives|is|equals)|keeps returning|continues to return)\s+/;
// A sentence that says what must stay: not "returns input unchanged", which states new behaviour.
const keepWording = /\b(?:must not change|must (?:stay|remain)|preserv\w*|unchanged:)/i;
const baseWording = /\b(?:today|currently|at the moment|now)\b[^.;]*$/i;
const reserved = new Set(["true", "false", "null", "undefined", "new", "typeof", "await"]);

/** The end of a balanced span opening at `open`, skipping string literals, or -1. */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let at = open; at < text.length; at += 1) {
    const char = text[at] as string;
    if (char === '"' || char === "'" || char === "`") {
      const end = stringEnd(text, at);
      if (end === -1) return -1;
      at = end;
      continue;
    }
    if (pairs[char] !== undefined) stack.push(pairs[char] as string);
    else if (char === ")" || char === "]" || char === "}") {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return at;
    }
  }
  return -1;
}

/** The index of the quote that closes a string literal opening at `open`, or -1. */
function stringEnd(text: string, open: number): number {
  const quote = text[open];
  for (let at = open + 1; at < text.length; at += 1) {
    if (text[at] === "\\") at += 1;
    else if (text[at] === quote) return at;
  }
  return -1;
}

/** A string, number, boolean or null literal at the start of `text`, with its length, or null. */
function literalAt(
  text: string,
): { readonly value: string | number | boolean | null; readonly length: number } | null {
  const first = text[0];
  if (first === '"' || first === "'") {
    const end = stringEnd(text, 0);
    if (end === -1) return null;
    const body = text.slice(1, end);
    try {
      const value =
        first === '"'
          ? (JSON.parse(text.slice(0, end + 1)) as string)
          : (JSON.parse(`"${body.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string);
      return { value, length: end + 1 };
    } catch {
      return null;
    }
  }
  const number = /^-?\d+(?:\.\d+)?(?![\w.])/.exec(text);
  if (number !== null) return { value: Number(number[0]), length: number[0].length };
  const word = /^(true|false|null)\b/.exec(text);
  if (word !== null)
    return {
      value: word[1] === "null" ? null : word[1] === "true",
      length: (word[1] as string).length,
    };
  return null;
}

interface Call {
  readonly name: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** The arguments split at their top-level commas, trimmed. */
  readonly args: readonly string[];
}

/** Every call to a bare name in `text`: not a method, not a declaration, its arguments balanced. */
function callsIn(text: string): readonly Call[] {
  const calls: Call[] = [];
  // Code writes a call with no space before its parenthesis; prose ("as given (for example") does.
  const name = /(?<![\w$.])([A-Za-z_$][\w$]*)\(/g;
  for (let found = name.exec(text); found !== null; found = name.exec(text)) {
    const open = found.index + found[0].length - 1;
    const end = closing(text, open);
    if (end === -1 || reserved.has(found[1] as string)) continue;
    const inner = text.slice(open + 1, end);
    calls.push({
      name: found[1] as string,
      text: text.slice(found.index, end + 1),
      start: found.index,
      end: end + 1,
      args: topLevelArgs(inner),
    });
    name.lastIndex = end + 1;
  }
  return calls;
}

function topLevelArgs(inner: string): readonly string[] {
  const args: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < inner.length; at += 1) {
    const char = inner[at] as string;
    if (char === '"' || char === "'" || char === "`") {
      const end = stringEnd(inner, at);
      if (end === -1) break;
      at = end;
    } else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      args.push(inner.slice(from, at).trim());
      from = at + 1;
    }
  }
  const last = inner.slice(from).trim();
  if (last.length > 0 || args.length > 0) args.push(last);
  return args;
}

/** The names a call reaches: its own and any bare name called inside its arguments. */
function namesIn(call: Call): readonly string[] {
  return [
    ...new Set([call.name, ...callsIn(call.text.slice(call.name.length)).map((one) => one.name)]),
  ];
}

const bareName = /^[A-Za-z_$][\w$]*$/;

/**
 * The task's sentences, split where `taskSentences` splits them (after `.`, `!`, `?` or `;` and
 * before a letter or a parenthesis) but never inside a string literal, and with the literals'
 * own spacing kept: `"ab  "` is two spaces, which a folded sentence would make one.
 */
function codeSentences(task: string): readonly string[] {
  const sentences: string[] = [];
  let from = 0;
  for (let at = 0; at < task.length; at += 1) {
    const char = task[at] as string;
    if (char === '"' || char === "`") {
      const end = stringEnd(task, at);
      if (end !== -1) at = end;
      continue;
    }
    if (".!?;".includes(char) && /^\s+[A-Za-z(]/.test(task.slice(at + 1, at + 3))) {
      sentences.push(task.slice(from, at + 1).trim());
      from = at + 1;
    }
  }
  sentences.push(task.slice(from).trim());
  return sentences.filter((one) => one.length > 0);
}

/**
 * The examples and relations the task writes as code, each with the sentence it is in. Ids
 * number them in the task's order.
 */
export function taskCodeStatements(task: string): readonly TaskCodeStatement[] {
  const statements: TaskCodeStatement[] = [];
  const sentences = codeSentences(task);
  const allCalls = sentences.flatMap((sentence) => callsIn(sentence));
  let examples = 0;
  let relations = 0;
  for (const sentence of sentences) {
    for (const call of callsIn(sentence)) {
      const after = sentence.slice(call.end).replace(/^\s+/, "");
      const preserving = preserveVerb.exec(after);
      const requesting = preserving === null ? requestedVerb.exec(after) : null;
      const verb = preserving ?? requesting;
      if (verb === null) continue;
      const rest = after.slice(verb[0].length);
      if (/^not\b/.test(rest)) continue;
      const literal = literalAt(rest);
      // An example names concrete arguments; a call over bare names ("keep(key, value) returns
      // true") describes a signature, often a callback's, and is not the project's answer.
      const concrete = !call.args.some((arg) => bareName.test(arg) && !reserved.has(arg));
      if (literal !== null && concrete) {
        const before = sentence.slice(0, call.start);
        // The verb decides first: "stays" keeps, whatever else the sentence says.
        const role: TaskExampleRole =
          preserving !== null
            ? "preserve"
            : baseWording.test(before) || /^\s*today\b/.test(rest.slice(literal.length))
              ? "base"
              : keepWording.test(before)
                ? "preserve"
                : "requested";
        examples += 1;
        statements.push({
          kind: "example",
          id: `code-example-${examples}`,
          role,
          sentence,
          call: call.text,
          names: namesIn(call),
          expected: literal.value,
        });
        continue;
      }
      // `call equals call`: a relation, where both take one free name in one position.
      if (requesting === null || !/^(?:equals|is|===?)\s+$/.test(verb[0])) continue;
      const other = callsIn(rest).find((one) => one.start === 0);
      if (other === undefined) continue;
      const free = call.args.findIndex((arg) => bareName.test(arg) && !reserved.has(arg));
      const variable = call.args[free];
      if (variable === undefined || !other.args.includes(variable)) continue;
      const otherPosition = other.args.indexOf(variable);
      const tail = rest.slice(other.end).trim();
      const contains =
        /^for (?:every|each|any|all) \w+ (?:that |which )?contains? (["'])(.+?)\1/.exec(tail) ??
        /^for (?:every|each|any|all) \w+ containing (["'])(.+?)\1/.exec(tail);
      const domain =
        contains !== null
          ? { contains: contains[2] as string }
          : /^(?:for|whenever|when|if|where|provided)\b/.test(tail)
            ? ("unfollowed" as const)
            : null;
      // Inputs: the task's own literals in the free name's position of calls to either function.
      const seeds = [
        ...new Set(
          allCalls.flatMap((one) => {
            const position =
              one.name === call.name ? free : one.name === other.name ? otherPosition : -1;
            const literal = position === -1 ? null : literalAt(one.args[position] ?? "");
            return literal !== null && typeof literal.value === "string" ? [literal.value] : [];
          }),
        ),
      ];
      relations += 1;
      statements.push({
        kind: "relation",
        id: `code-relation-${relations}`,
        sentence,
        subject: call.text,
        reference: other.text,
        subjectName: call.name,
        referenceName: other.name,
        variable,
        domain,
        inputs: relationInputs(seeds, domain),
      });
    }
  }
  return statements;
}

/** At most this many inputs per relation, the task's own first. */
export const maxRelationInputs = 12;

/**
 * The seeds inside the domain, then each seed outside it carried into it: where the domain is
 * "contains S", a seed without S gets S and the tail every seed with S has after its first S. So
 * the task's `file:///C:/x`, which has no `?`, is also tried as `file:///C:/x?bar=1&baz=2`.
 */
export function relationInputs(
  seeds: readonly string[],
  domain: TaskRelation["domain"],
): readonly string[] {
  if (domain === null || domain === "unfollowed") return seeds.slice(0, maxRelationInputs);
  const inside = seeds.filter((one) => one.includes(domain.contains));
  const tails = [
    ...new Set(
      inside.map((one) => one.slice(one.indexOf(domain.contains) + domain.contains.length)),
    ),
  ];
  const carried = seeds
    .filter((one) => !one.includes(domain.contains))
    .flatMap((one) => tails.map((tail) => `${one}${domain.contains}${tail}`));
  // Alternated, so a cap never cuts every carried input: they are why the domain is followed.
  const alternated = Array.from({ length: Math.max(inside.length, carried.length) }, (_, index) => [
    inside[index],
    carried[index],
  ]).flat();
  return [...new Set(alternated.filter((one): one is string => one !== undefined))].slice(
    0,
    maxRelationInputs,
  );
}
