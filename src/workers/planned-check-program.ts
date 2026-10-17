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
type PlannedCase = z.infer<typeof caseSchema>;

/**
 * Reads the program and the inputs from stdin, writes the program beside the checkout's root for
 * as long as it takes to import it (so `./` imports resolve from there, as they read), calls its
 * default export once per input, and prints one JSON line per input with object keys sorted.
 * What the program or the project prints is moved to stderr, so stdout carries only results. A
 * thrown case is a result, not a crash: it prints `threw` and its message goes to stderr. A
 * program that does not load exits 3, which the harness reads as a check that never ran rather
 * than as a wrong answer.
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
  '    line = { input, result: JSON.parse(JSON.stringify(result === undefined ? null : result) ?? "null") };',
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
): readonly string[] {
  const problems: string[] = [];
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
  const taskText = folded(task);
  for (const requirement of input.requirements) {
    const checks = input.checks.filter((check) => check.requirement === requirement.id);
    if (checks.length === 0)
      problems.push(`requirement ${requirement.id} has no check; give it one or leave it out`);
    if (requirement.quote !== undefined && !taskText.includes(folded(requirement.quote)))
      problems.push(
        `requirement ${requirement.id}: its quote is not in the task text; quote the task's own words`,
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
): GoalContract {
  const problems = declarationProblems(goal, input, base);
  if (problems.length > 0) throw new Error(`fix these and declare again: ${problems.join("; ")}`);
  const requirements = input.requirements.map((requirement) => ({
    id: requirement.id,
    description:
      requirement.quote === undefined
        ? requirement.description
        : `${requirement.description} (the task: "${requirement.quote}")`,
    checks: input.checks
      .filter((check) => check.requirement === requirement.id)
      .map((one) => one.id),
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
