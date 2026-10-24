import { createHash } from "node:crypto";

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
 *
 * task-code-v2 adds one statement and inputs beyond the task's literals:
 * - **enumeration**: `<callback> is called once for each <entry> of <reference>(<input>)`, where
 *   the task declares a function with both names as parameters (`f(input: string, callback: (key:
 *   string, value: string) => boolean)`). The expectation is the entries of the reference's answer
 *   on the unchanged base, in order where the sentence says so, so a callback asked twice about one
 *   entry, or never about one, is a counterexample whose every part is the task's;
 * - **generated inputs** inside a followed domain (`domain-inputs-v1`), from the task's own
 *   literals, with a seed derived from the task's text and recorded: a discovery batch beside the
 *   literals, and a separate validation batch kept back to test a repair beyond what it was shown.
 */
export const taskCodeRule = "task-code-v2";

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

/**
 * A callback the task says is called once for each entry of an existing function's answer
 * (task-code-v2). Run as a relation: the subject records the callback's calls on the candidate,
 * and the reference lists the entries of its answer on the unchanged base.
 */
export interface TaskEnumeration {
  readonly kind: "enumeration";
  readonly id: string;
  readonly sentence: string;
  /** The function the task declares, which takes both the input and the callback. */
  readonly subjectName: string;
  /** Its declared parameters, in order. */
  readonly parameters: readonly string[];
  readonly callback: string;
  /** The parameter each input is bound to, which the reference call also takes. */
  readonly variable: string;
  /** The reference call, verbatim: the function whose answer's entries the callback must see. */
  readonly reference: string;
  readonly referenceName: string;
  /** How many of each call's arguments are compared: the entry's key, and its value if stated. */
  readonly arity: 1 | 2;
  /** Whether the sentence states the order ("in that order"); otherwise calls compare as a set. */
  readonly ordered: boolean;
  readonly domain: TaskRelation["domain"];
  readonly inputs: readonly string[];
}

export type TaskCodeStatement = TaskExample | TaskRelation | TaskEnumeration;

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
export function codeSentences(task: string): readonly string[] {
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
  return [...statements, ...taskEnumerations(sentences, allCalls, statements)];
}

const enumeration =
  /\b([A-Za-z_$][\w$]*) is (?:called|invoked) (?:exactly )?once (?:for each|for every|per) (?:[A-Za-z]+ ){0,2}?(?:of|in) ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)/g;
const declaredParameter = /^([A-Za-z_$][\w$]*)(\??)\s*:/;

/**
 * The callbacks the task says are called once for each entry of an existing function's answer,
 * where the task declares the function that takes them. A declaration is a call whose every
 * argument is `name: type`; a parameter besides the input and the callback must be optional
 * (`name?: type`), since the harness has nothing of the task's to pass for it.
 */
function taskEnumerations(
  sentences: readonly string[],
  allCalls: readonly Call[],
  read: readonly TaskCodeStatement[],
): readonly TaskEnumeration[] {
  const declarations = allCalls.flatMap((one) => {
    const parameters = one.args.map((arg) => declaredParameter.exec(arg));
    return one.args.length > 0 && parameters.every((match) => match !== null)
      ? [{ call: one, parameters: parameters as RegExpExecArray[] }]
      : [];
  });
  const found: TaskEnumeration[] = [];
  for (const sentence of sentences) {
    for (const match of sentence.matchAll(enumeration)) {
      const [, callback, referenceName, variable] = match as unknown as [
        string,
        string,
        string,
        string,
      ];
      const declared = declarations.find(({ parameters }) => {
        const names = parameters.map((one) => one[1]);
        return names.includes(callback) && names.includes(variable) && callback !== variable;
      });
      if (declared === undefined) continue;
      const names = declared.parameters.map((one) => one[1] as string);
      if (
        declared.parameters.some(
          (one) => one[1] !== callback && one[1] !== variable && one[2] !== "?",
        )
      )
        continue;
      // The callback's declared type gives its arguments: `(key: string, value: ...) => boolean`.
      const type = (declared.call.args[names.indexOf(callback)] ?? "").replace(
        declaredParameter,
        "",
      );
      const open = type.indexOf("(");
      const close = open === -1 ? -1 : closing(type, open);
      const declaredArity = close === -1 ? 1 : topLevelArgs(type.slice(open + 1, close)).length;
      const after = sentence.slice((match.index ?? 0) + match[0].length);
      const relation = read.find(
        (one): one is TaskRelation =>
          one.kind === "relation" &&
          one.subjectName === declared.call.name &&
          one.variable === variable,
      );
      const domain =
        relation !== undefined && relation.sentence === sentence ? relation.domain : null;
      const position = names.indexOf(variable);
      const literals = [
        ...new Set(
          allCalls.flatMap((one) => {
            const literal =
              one.name === declared.call.name ? literalAt(one.args[position] ?? "") : null;
            return literal !== null && typeof literal.value === "string" ? [literal.value] : [];
          }),
        ),
      ];
      found.push({
        kind: "enumeration",
        id: `code-enumeration-${found.length + 1}`,
        sentence,
        subjectName: declared.call.name,
        parameters: names,
        callback,
        variable,
        reference: `${referenceName}(${variable})`,
        referenceName,
        arity: declaredArity >= 2 && /\bvalues?\b/.test(after) ? 2 : 1,
        ordered: /\bin (?:that|the same|this|their) order\b|\bin order\b/.test(sentence),
        domain,
        inputs: relation?.inputs ?? relationInputs(literals, domain),
      });
    }
  }
  return found;
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

/**
 * Inputs generated inside a domain from the task's own literals (domain-inputs-v1), reproducible
 * from the recorded seed. Each literal is cut into segments, each starting at a character that is
 * not a letter or digit (`/foo?a=1#h` is `/foo`, `?a`, `=1`, `#h`), and one input is made by one
 * operation on one or two literals: splicing the head of one onto the tail of another, moving,
 * dropping, repeating or blanking a segment, or inserting another literal's segment. An input is
 * kept only inside the domain, at most `maxLength` long, new, and of a shape (its letters and digits
 * folded) no input chosen or excluded already has, so near-duplicates do not fill the batch; where
 * new shapes run out, a second pass takes new strings of a shape already seen.
 */
export const domainInputsRule = "domain-inputs-v1";

export interface GeneratedInputs {
  readonly rule: typeof domainInputsRule;
  readonly label: "discovery" | "validation";
  readonly seed: number;
  readonly inputs: readonly string[];
  /** How each input was made, in input order. */
  readonly provenance: readonly string[];
  readonly limits: {
    readonly count: number;
    readonly attempts: number;
    readonly maxLength: number;
  };
}

/** A discovery batch beside the task's literals, and a validation batch kept apart from both. */
export const generatedCounts = { discovery: 6, validation: 12 } as const;
const attemptsPerInput = 80;
const maxGeneratedLength = 160;

/** The seed a batch is generated from: the task, the statement and the batch, digested. */
export function batchSeed(
  task: string,
  statement: string,
  label: GeneratedInputs["label"],
): number {
  return Number.parseInt(
    createHash("sha256")
      .update(`${domainInputsRule}\0${label}\0${statement}\0${task}`)
      .digest("hex")
      .slice(0, 8),
    16,
  );
}

/** A small deterministic generator (mulberry32): the same seed gives the same sequence. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const segmentsOf = (text: string): readonly string[] =>
  text.match(/[^A-Za-z0-9]?[A-Za-z0-9]*/g)?.filter((one) => one.length > 0) ?? [];
const shapeOf = (text: string) => text.replace(/[A-Za-z0-9]+/g, "a");

export function generateDomainInputs(
  seeds: readonly string[],
  domain: TaskRelation["domain"],
  options: {
    readonly label: GeneratedInputs["label"];
    readonly seed: number;
    readonly count: number;
    readonly exclude: readonly string[];
  },
): GeneratedInputs {
  const limits = {
    count: options.count,
    attempts: options.count * attemptsPerInput,
    maxLength: maxGeneratedLength,
  };
  const blank = {
    rule: domainInputsRule,
    label: options.label,
    seed: options.seed,
    limits,
  } as const;
  const usable = seeds.filter((one) => one.length > 0);
  if (domain === "unfollowed" || usable.length === 0 || options.count <= 0)
    return { ...blank, inputs: [], provenance: [] };
  const random = sequence(options.seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const at = (length: number) => Math.floor(random() * (length + 1));
  const operations = [
    (a: readonly string[], b: readonly string[]) => [
      [...a.slice(0, at(a.length)), ...b.slice(at(b.length))],
      "splice",
    ],
    (a: readonly string[]) => {
      const moved = [...a];
      const [segment] = moved.splice(Math.floor(random() * moved.length), 1);
      moved.splice(at(moved.length), 0, segment as string);
      return [moved, "move"];
    },
    (a: readonly string[]) => {
      const dropped = [...a];
      dropped.splice(Math.floor(random() * dropped.length), 1);
      return [dropped, "drop"];
    },
    (a: readonly string[]) => {
      const repeated = [...a];
      const index = Math.floor(random() * repeated.length);
      repeated.splice(index, 0, repeated[index] as string);
      return [repeated, "repeat"];
    },
    (a: readonly string[]) => {
      const blanked = [...a];
      const index = Math.floor(random() * blanked.length);
      blanked[index] = (blanked[index] as string).replace(/[A-Za-z0-9]+$/, "");
      return [blanked, "blank"];
    },
    (a: readonly string[], b: readonly string[]) => {
      const inserted = [...a];
      inserted.splice(at(inserted.length), 0, pick(b));
      return [inserted, "insert"];
    },
  ] as const;
  const taken = new Set(options.exclude);
  const shapes = new Set(options.exclude.map(shapeOf));
  const inputs: string[] = [];
  const provenance: string[] = [];
  for (const pass of ["new-shape", "new-string"] as const) {
    for (
      let attempt = 0;
      attempt < limits.attempts && inputs.length < options.count;
      attempt += 1
    ) {
      const first = pick(usable);
      const second = pick(usable);
      const operation = pick(operations);
      const [segments, name] = operation(segmentsOf(first), segmentsOf(second));
      const made = (segments as readonly string[]).join("");
      if (
        made.length === 0 ||
        made.length > limits.maxLength ||
        taken.has(made) ||
        (domain !== null && !made.includes(domain.contains)) ||
        (pass === "new-shape" && shapes.has(shapeOf(made)))
      )
        continue;
      taken.add(made);
      shapes.add(shapeOf(made));
      inputs.push(made);
      provenance.push(
        `${name} of ${JSON.stringify(first)}${name === "splice" || name === "insert" ? ` and ${JSON.stringify(second)}` : ""}`,
      );
    }
  }
  return { ...blank, inputs, provenance };
}

/**
 * A relation's or enumeration's two generated batches: discovery, which runs with the task's own
 * inputs, and validation, generated at the same time from a separate seed, excluding both, and held
 * back until a repair is assessed.
 */
export function generatedBatches(
  task: string,
  statement: TaskRelation | TaskEnumeration,
): { readonly discovery: GeneratedInputs; readonly validation: GeneratedInputs } {
  const discovery = generateDomainInputs(statement.inputs, statement.domain, {
    label: "discovery",
    seed: batchSeed(task, statement.id, "discovery"),
    count: generatedCounts.discovery,
    exclude: statement.inputs,
  });
  const validation = generateDomainInputs(statement.inputs, statement.domain, {
    label: "validation",
    seed: batchSeed(task, statement.id, "validation"),
    count: generatedCounts.validation,
    exclude: [...statement.inputs, ...discovery.inputs],
  });
  return { discovery, validation };
}
