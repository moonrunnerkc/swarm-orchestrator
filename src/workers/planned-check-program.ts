import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import {
  freezeGoalContract,
  type GoalCheckDefinition,
  type GoalContract,
} from "../evidence/goal-contract.ts";

/**
 * The planner's side of a planned check, and its translation into the contract's own check.
 *
 * A planner states what the task requires and how to observe it: a short program that calls the
 * project, the inputs to call it with, the result each must give, and whether the check covers
 * the requested change or behaviour the task keeps. Everything mechanical is the harness's: the
 * runner that loads the program and calls it once per input, the argv, the working directory,
 * the limits, the exact stdout and the base expectation. A planner made to spell those out
 * duplicated argv as command text, mistyped trailing newlines and declared fields the harness
 * already knew, and spent its planning allowance on that instead of on the task.
 *
 * The result is an ordinary command-line behavior check, judged by the same goal verifier as
 * every other check: the harness compares the captured stdout with the expected lines, never the
 * program. The program travels on stdin with the inputs, not as a file artifact, because a
 * pinned file needs read-only mounts the host backend does not have.
 */
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
/**
 * Any JSON value. Not `z.json()`: its JSON Schema closes every object to no properties at all,
 * so a model that follows the tool schema could pass only empty objects as inputs or results.
 */
const jsonValue = z.unknown().refine(
  (value) => {
    try {
      return JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value);
    } catch {
      return false;
    }
  },
  { message: "must be a JSON value: a string, number, boolean, null, array or object of those" },
);
const caseSchema = z.union([
  z.strictObject({ input: jsonValue, expected: jsonValue }),
  z.strictObject({ input: jsonValue, throws: z.literal(true) }),
]);
export const plannedChecksInput = z.strictObject({
  requirements: z
    .array(
      z.strictObject({
        id,
        description: z.string().min(1).max(2000),
        quote: z.string().min(1).max(2000).optional(),
      }),
    )
    .min(1)
    .max(16),
  checks: z
    .array(
      z.strictObject({
        id,
        requirement: id,
        purpose: z.enum(["change", "preserve"]),
        program: z.string().min(1).max(16_000),
        cases: z.array(caseSchema).min(1).max(32),
        why: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(16),
});
export type PlannedChecksDeclaration = z.infer<typeof plannedChecksInput>;

/**
 * One planned check per call, every field at the top level, the requirement named beside it.
 * Declared as an array of nested objects, live planners wrote JavaScript inside the array
 * (template strings for programs, `undefined` for values), which the local server could not
 * parse and passed on as one string; a program as its own string parameter is written as it is.
 */
const slug = (example: string) =>
  id.describe(`lowercase letters, digits and hyphens, starting with a letter, such as ${example}`);
export const plannedCheckInput = z.strictObject({
  id: slug("negative-size-refused"),
  purpose: z
    .enum(["change", "preserve"])
    .describe("change: behaviour the task changes; preserve: behaviour the task keeps"),
  requirementId: slug("size-rule"),
  // The words go where live planners put them: told to give an id in `requirement`, five calls
  // in a row put the requirement's sentence there instead.
  requirement: z.string().min(1).max(2000).describe("the requirement this check covers, in words"),
  quote: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .describe("the task's own words that state the requirement; required for a change check"),
  program: z
    .string()
    .min(1)
    .max(16_000)
    .describe("an ES module whose default export takes one case's input and returns the result"),
  cases: z.array(caseSchema).min(1).max(32),
  why: z.string().min(1).max(2000).describe("how the expected results follow from the task"),
});
export type PlannedCheckCall = z.infer<typeof plannedCheckInput>;

/**
 * The declaration so far with one call folded in: the check replaces any of the same id, and
 * the requirement it names takes the call's description, and its quote where the call gives one.
 */
export function withPlannedCheck(
  declaration: PlannedChecksDeclaration | null,
  call: PlannedCheckCall,
): PlannedChecksDeclaration {
  const check = {
    id: call.id,
    requirement: call.requirementId,
    purpose: call.purpose,
    program: call.program,
    cases: call.cases,
    why: call.why,
  };
  const checks = [...(declaration?.checks ?? []).filter((one) => one.id !== call.id), check];
  const previous = declaration?.requirements.find((one) => one.id === call.requirementId);
  const quote = call.quote ?? previous?.quote;
  const requirement = {
    id: call.requirementId,
    description: call.requirement,
    ...(quote === undefined ? {} : { quote }),
  };
  // In declaration order: a requirement a later call names again keeps its place.
  const requirements = (
    previous === undefined
      ? [...(declaration?.requirements ?? []), requirement]
      : (declaration?.requirements ?? []).map((one) =>
          one.id === call.requirementId ? requirement : one,
        )
  ).filter((one) => checks.some((check) => check.requirement === one.id));
  return { requirements, checks };
}
type PlannedCase = z.infer<typeof caseSchema>;

/**
 * Reads the program and the inputs from stdin, writes the program beside the checkout's root for
 * as long as it takes to import it (so `./` imports resolve from there, as they read), calls its
 * default export once per input, and prints one JSON line per input with object keys sorted.
 * What the program or the project prints is moved to stderr, so stdout carries only results. A
 * thrown case is a result, not a crash: it prints `threw` and its message goes to stderr. A
 * program that does not load exits 3, which the harness reads as a check that never ran rather
 * than as a wrong answer. Undefined reads as null wherever it sits, as the tool's description
 * says: dropped from an object instead, a live planner's `{ size: null }` met `{}` and its checks
 * refused every compliant implementation.
 */
export const plannedCheckRunner = [
  'import { rmSync, writeFileSync } from "node:fs";',
  'import { resolve } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  "const write = process.stdout.write.bind(process.stdout);",
  "process.stdout.write = process.stderr.write.bind(process.stderr);",
  "const plain = (value) =>",
  "  Array.isArray(value)",
  "    ? value.map(plain)",
  '    : value !== null && typeof value === "object"',
  "      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, plain(value[key])]))",
  "      : value;",
  'let text = "";',
  "for await (const chunk of process.stdin) text += chunk;",
  "const { program, inputs } = JSON.parse(text);",
  'const path = resolve(".swarm-check-" + process.pid + ".mjs");',
  "let run;",
  "try {",
  '  writeFileSync(path, program, { flag: "wx" });',
  "  ({ default: run } = await import(pathToFileURL(path).href));",
  "} catch (error) {",
  '  console.error("the check program did not load: " + (error?.stack ?? error));',
  "  process.exit(3);",
  "} finally {",
  "  rmSync(path, { force: true });",
  "}",
  'if (typeof run !== "function") {',
  '  console.error("the check program does not export a default function");',
  "  process.exit(3);",
  "}",
  "for (const [index, input] of inputs.entries()) {",
  "  let line;",
  "  try {",
  "    const result = await run(input);",
  '    line = { input, result: JSON.parse(JSON.stringify(result, (key, value) => (value === undefined ? null : value)) ?? "null") };',
  "  } catch (error) {",
  '    console.error("case " + (index + 1) + " threw: " + (error?.stack ?? error));',
  "    line = { input, threw: true };",
  "  }",
  '  write(JSON.stringify(plain(line)) + "\\n");',
  "}",
].join("\n");

/** What a program that never loaded exits with, which admission reads as a check that never ran. */
export const programDidNotLoad = 3;

/** The runner's own key order, so the expected lines and the printed ones compare exactly. */
function plain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, plain((value as Record<string, unknown>)[key])]),
    );
  return value;
}

function expectedLine(one: PlannedCase): string {
  return `${JSON.stringify(plain("throws" in one ? { input: one.input, threw: true } : { input: one.input, result: one.expected }))}\n`;
}

const stdoutLimit = 64_000;
const stdinLimit = 64_000;

function contractCheck(check: PlannedChecksDeclaration["checks"][number]): GoalCheckDefinition {
  return {
    id: check.id,
    // Shown where criteria are listed; the behavior below is what runs.
    command: `planned check: ${check.cases.length} case(s) through the default export of its program`,
    author: "model",
    exposure: "shared",
    atBase: check.purpose === "change" ? "fails" : "passes",
    artifacts: [],
    behavior: {
      kind: "cli",
      cwd: ".",
      timeoutMs: 60_000,
      maxOutputBytes: 256_000,
      toolchain: "Node",
      network: "inherit",
      environment: {},
      argv: ["node", "--input-type=module", "-e", plannedCheckRunner],
      stdin: JSON.stringify({
        program: check.program,
        inputs: check.cases.map((one) => one.input),
      }),
      exitCode: 0,
      stdout: [{ kind: "equals", value: check.cases.map(expectedLine).join("") }],
      stderr: [],
    },
  };
}

/**
 * The verbatim parts of a quote, split where it elides with an ellipsis, as quotations do.
 * Planners quoting long sentences elided their middles, and a verbatim-only rule refused them.
 */
function fragments(quote: string): readonly string[] {
  // A quote wrapped in its own quotation marks is still the task's words: a live planner wrapped
  // every quote so, and each was refused for the marks alone.
  return folded(quote)
    .replace(/^["'`]+|["'`]+$/g, "")
    .split(/\s*(?:\.\.\.|\u2026)\s*/)
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
}

/** Whether every verbatim part of a quote is in the text, in order. */
function quotedIn(text: string, quote: string): boolean {
  const haystack = folded(text);
  const parts = fragments(quote);
  let from = 0;
  for (const part of parts) {
    const at = haystack.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return parts.length > 0;
}

/** Whitespace, case and quotation marks folded, so a faithful quote is found however it was typed. */
function folded(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * What is wrong with a declaration, each problem named so the planner can fix it. A requirement a
 * change check covers must quote the task, since a check of a change the task never asked for
 * would make the implementation answer to a guess; a requirement of preserved behaviour may
 * quote it and need not, since keeping what already works is every task's obligation.
 */
export function declarationProblems(
  task: string,
  input: PlannedChecksDeclaration,
  base: GoalContract | undefined,
  repository?: RepositoryView,
): readonly string[] {
  const problems: string[] = [];
  if (repository !== undefined)
    for (const check of input.checks) problems.push(...importProblems(check, repository));
  // Requirements and checks are two namespaces, as in the contract, where one id often names both.
  for (const [kind, declared, existing] of [
    ["requirement", input.requirements, base?.requirements ?? []],
    ["check", input.checks, base?.checks ?? []],
  ] as const) {
    const taken = new Set(existing.map((one) => one.id));
    const seen = new Set<string>();
    for (const one of declared) {
      if (taken.has(one.id))
        problems.push(`${kind} ${one.id} already exists in the contract; use a new id`);
      else if (seen.has(one.id))
        problems.push(`${kind} ${one.id} is declared twice; ids must be unique`);
      seen.add(one.id);
    }
  }
  const requirementIds = new Set(input.requirements.map((one) => one.id));
  for (const requirement of input.requirements) {
    const checks = input.checks.filter((check) => check.requirement === requirement.id);
    if (checks.length === 0)
      problems.push(`requirement ${requirement.id} has no check; give it one or leave it out`);
    if (requirement.quote !== undefined && !quotedIn(task, requirement.quote))
      problems.push(
        `requirement ${requirement.id}: its quote is not in the task text; quote the task's own words (an elided part may be written ...)`,
      );
    if (requirement.quote === undefined && checks.some((check) => check.purpose === "change"))
      problems.push(
        `requirement ${requirement.id} is covered by a change check, so quote the task's words that ask for it`,
      );
  }
  for (const check of input.checks) {
    if (!requirementIds.has(check.requirement))
      problems.push(
        `check ${check.id} names requirement ${check.requirement}, which this declaration does not declare`,
      );
    if (!/\bexport\s+default\b/.test(check.program))
      problems.push(
        `check ${check.id}: the program must export a default function (export default function (input) { ... })`,
      );
    const built = contractCheck(check);
    if (built.behavior?.kind === "cli" && built.behavior.stdin.length > stdinLimit)
      problems.push(
        `check ${check.id}: its program and inputs are too large; use a shorter program or fewer cases`,
      );
    if (
      built.behavior?.kind === "cli" &&
      (built.behavior.stdout[0]?.value.length ?? 0) > stdoutLimit
    )
      problems.push(`check ${check.id}: its expected results are too large; use fewer cases`);
  }
  return problems;
}

/** The repository a planner reads, as far as checking a program's imports needs it. */
export interface RepositoryView {
  readonly root: string;
  readonly exists: (path: string) => boolean;
}

/** Every specifier a program imports, statically, dynamically or through require. */
function importedSpecifiers(program: string): readonly string[] {
  return [
    ...new Set(
      [
        ...program.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g),
        ...program.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
        ...program.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((match) => match[1] ?? ""),
    ),
  ];
}

/** The relative specifiers a program imports, statically or dynamically. */
function relativeImports(program: string): readonly string[] {
  return importedSpecifiers(program).filter((one) => one.startsWith("./") || one.startsWith("../"));
}

/**
 * Imports that cannot load where the program runs, found before anything runs: a path that
 * leaves the repository (programs run from its root, and live planners copied the `../dist`
 * of the repository's test files), and a `.js` path where only TypeScript source exists, which
 * the harness does not compile. A path that is merely absent is left alone, since build output
 * appears only once the preparation has run.
 */
function importProblems(
  check: PlannedChecksDeclaration["checks"][number],
  repository: RepositoryView,
): readonly string[] {
  const problems: string[] = [];
  // A program that loads nothing but the runtime's own modules cannot observe the project, so
  // its results say nothing about any implementation: a constant program can still get one base
  // case right and another wrong, which is all admission asks of a change check.
  if (!importedSpecifiers(check.program).some((one) => !one.startsWith("node:")))
    problems.push(
      `check ${check.id} imports nothing from the repository, so it cannot observe the project: import the module the task changes (./path/from/the/root) and call it`,
    );
  for (const specifier of relativeImports(check.program)) {
    const target = join(repository.root, specifier);
    const within = relative(repository.root, target);
    if (within === ".." || within.startsWith("../") || isAbsolute(within)) {
      problems.push(
        `check ${check.id} imports ${specifier}, which leaves the repository: the program runs from the repository root, so write the path from there (./...)`,
      );
      continue;
    }
    const source = target.replace(/\.(?:m|c)?js$/, ".ts");
    if (source !== target && !repository.exists(target) && repository.exists(source))
      problems.push(
        `check ${check.id} imports ${specifier}, which does not exist; ./${relative(repository.root, source)} is TypeScript source the harness does not compile, so import the build output the repository's own tests import`,
      );
  }
  return problems;
}

/**
 * The planner's additions on top of a supplied contract, or the planner's contract alone. The
 * supplied goal, requirements, checks, preset and immutable paths stand unchanged; what the
 * planner adds is ordinary checks built from its programs, and it cannot author a preset,
 * challenge fixtures or references, which are what admission would trust.
 */
export function plannedContract(
  goal: string,
  input: PlannedChecksDeclaration,
  base: GoalContract | undefined,
  repository?: RepositoryView,
): GoalContract {
  const problems = declarationProblems(goal, input, base, repository);
  if (problems.length > 0) throw new Error(`fix these and declare again: ${problems.join("; ")}`);
  // A planned requirement is decided by no check: its checks are diagnostics, so the run's own
  // reading of the task never becomes the grounds for calling the task done.
  const requirements = input.requirements.map((requirement) => ({
    id: requirement.id,
    description: requirement.description,
    checks: [],
    planned: {
      ...(requirement.quote === undefined ? {} : { quote: requirement.quote }),
      diagnostics: input.checks
        .filter((check) => check.requirement === requirement.id)
        .map((one) => one.id),
    },
  }));
  return freezeGoalContract({
    version: 1,
    goal: base?.goal ?? goal,
    ...(base?.preset === undefined ? {} : { preset: base.preset }),
    requirements: [...(base?.requirements ?? []), ...requirements],
    checks: [...(base?.checks ?? []), ...input.checks.map(contractCheck)],
    immutablePaths: [...(base?.immutablePaths ?? [])],
    ...(base === undefined ? {} : { selection: base.selection }),
    ...(base?.challenges === undefined ? {} : { challenges: base.challenges }),
  }).contract;
}

/** What a built planned check carries on stdin, or null for any other check. */
function carried(check: GoalCheckDefinition): { program?: unknown; inputs?: unknown } | null {
  if (check.behavior?.kind !== "cli" || check.behavior.argv[3] !== plannedCheckRunner) return null;
  try {
    return JSON.parse(check.behavior.stdin) as { program?: unknown; inputs?: unknown };
  } catch {
    return null;
  }
}

/** The program a built planned check carries, for showing it back to the planner that wrote it. */
export function plannedProgram(check: GoalCheckDefinition): string | null {
  const program = carried(check)?.program;
  return typeof program === "string" ? program : null;
}

/** The inputs a built planned check carries, in case order. */
export function plannedInputs(check: GoalCheckDefinition): readonly unknown[] | null {
  const inputs = carried(check)?.inputs;
  return Array.isArray(inputs) ? inputs : null;
}

/** A value as the harness read it, with line terminators and other invisible characters escaped. */
export function inputAsRead(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replace(
    /[\u2028\u2029\u007f-\u009f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Every string inside a value, however deeply nested. */
function stringsIn(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

/**
 * The cases as the harness read them, and a warning for each input holding a backslash before
 * n, r, t or u: the two characters a model writes when it escapes a line feed twice inside the
 * tool's JSON. A live planner did that for every case of its change check, which then passed on
 * the base and was dropped. Nothing is unescaped for it, since a backslash can be meant (a
 * Windows path is one); the planner is told, and may declare again.
 */
export function describeDeclaredCases(input: PlannedChecksDeclaration): readonly string[] {
  const lines: string[] = [];
  for (const check of input.checks) {
    lines.push(
      `${check.id} inputs as read: ${check.cases.map((one) => inputAsRead(one.input)).join(", ")}`,
    );
    check.cases.forEach((one, index) => {
      const escaped = stringsIn(one.input).find((text) => /\\[nrtu]/.test(text));
      if (escaped !== undefined)
        lines.push(
          `warning: ${check.id} case ${index + 1} holds a backslash followed by ${/\\([nrtu])/.exec(escaped)?.[1]}, which is two characters, not a line terminator or tab. If you meant the control character, write it inside the JSON string with one backslash (\\n) and declare again; if the backslash is meant, leave it.`,
        );
    });
  }
  return lines;
}

/** The task's sentences, in order, as the planner is shown them and coverage is reported over. */
export function taskSentences(task: string): readonly string[] {
  return task
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z("'`])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** The 1-based numbers of the sentences any of these quotes comes from. */
export function sentencesQuoted(task: string, quotes: readonly string[]): readonly number[] {
  const sentences = taskSentences(task).map(folded);
  const covered = new Set<number>();
  for (const parts of quotes.map(fragments)) {
    sentences.forEach((sentence, index) => {
      if (
        parts.some(
          (part) =>
            (part.length >= 12 || parts.length === 1) &&
            (sentence.includes(part) || part.includes(sentence)),
        )
      )
        covered.add(index + 1);
    });
  }
  return [...covered].sort((left, right) => left - right);
}

/**
 * The task's sentences no declared requirement quotes, for the declaration's answer. The harness
 * does not decide which of them state behaviour; it names them, and the planner covers each or
 * leaves it. Two live planners covered only the sentences that carried the task's own examples
 * and left the rule the retained wrong patches broke (a preservation sentence, a rule about any
 * position) with no requirement at all.
 */
export function describeUncoveredSentences(
  task: string,
  input: PlannedChecksDeclaration,
): readonly string[] {
  const quoted = new Set(
    sentencesQuoted(
      task,
      input.requirements.flatMap((one) => (one.quote === undefined ? [] : [one.quote])),
    ),
  );
  const uncovered = taskSentences(task)
    .map((sentence, index) => ({ sentence, number: index + 1 }))
    .filter((one) => !quoted.has(one.number));
  if (uncovered.length === 0) return ["Every sentence of the task is quoted by a requirement."];
  return [
    "Task sentences no requirement quotes yet. A sentence that states behaviour (what changes, what must keep working) is covered by a requirement that quotes it, with a check; one that only says how to work (which files to change, how to build or test) needs none:",
    ...uncovered.map(
      (one) =>
        `[${one.number}] ${one.sentence.length <= 220 ? one.sentence : `${one.sentence.slice(0, 217)}...`}`,
    ),
  ];
}
