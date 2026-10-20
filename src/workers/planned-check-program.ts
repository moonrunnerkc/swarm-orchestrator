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
/**
 * Whether the task changes a case's result, in a change check. A case the task keeps must give its
 * expected result on the unchanged base, which admission checks through the same program; a
 * changed case's expectation is the planner's claim. Without the distinction a live planner's
 * `foo.txt` case, which its own reasoning called "preserved", was read as a claimed change, and
 * its wrong expectation drove two repairs.
 */
const changed = z
  .boolean()
  .optional()
  .describe(
    "in a change check: true where the task changes this case's result, false where the task keeps it (the unchanged base already gives the expected result)",
  );
const caseSchema = z.union([
  z.strictObject({ input: jsonValue, expected: jsonValue, changed }),
  z.strictObject({ input: jsonValue, throws: z.literal(true), changed }),
]);
/**
 * A rule the task states as an equivalence, exercised systematically instead of by examples: an
 * input holding a variant text must give the result the same input gives holding the reference
 * text. The harness inserts the reference and every variant at every position of every seed and
 * compares each variant's result with the reference's at that position, on the same tree, so no
 * expected value is written down and none comes from the base. Live planners wrote cases shaped
 * like the task's own example and missed the position an implementation got wrong; enumeration
 * reaches every position of the seeds it is given and nothing beyond them.
 */
// Bounded by its shape: at most 6 seeds of 49 positions, each called with the reference and up
// to 6 variants, is 2058 calls, and at most 6 output lines of two counterexamples each.
const relationSchema = z.strictObject({
  seeds: z.array(z.string().max(48)).min(1).max(6),
  reference: z.string().min(1).max(4),
  variants: z.array(z.string().min(1).max(4)).min(1).max(6),
});
export type PlannedRelation = z.infer<typeof relationSchema>;
/** Counterexamples a failing seed reports: the first by position, enough to reproduce it. */
export const relationCounterexamples = 2;
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
        /** Cases with their expected results, or a relation the harness enumerates; one of the two. */
        cases: z.array(caseSchema).min(1).max(32).optional(),
        relation: relationSchema.optional(),
        why: z.string().min(1).max(2000),
        /**
         * The task's words this check was declared with. Its requirement's quote is the latest
         * call's, so it cannot say what an earlier check under the same requirement covered.
         */
        quote: z.string().min(1).max(2000).optional(),
      }),
    )
    .min(1)
    .max(16),
});
/**
 * A requested outcome as the planner's declarations identify it: under one requirement, the
 * task's words a declared check quotes, and whether the cases declared for it change behaviour or
 * keep it. D1's requirement `scheme-case-insensitive` held two: a scheme of any case still links
 * (checked, and the base had it), and the task's own example `(See hTtPS://...)` links with its
 * trailing period excluded (its one check refused); counted per requirement, the first made the
 * second read as covered. An outcome is never removed once declared, so one stays in view when
 * every check of it is refused or replaced by one that states other words. This is identity from
 * the planner's own declarations, not an understanding of the task: two outcomes the planner
 * stated in one quote with one role are one outcome here, and one it never stated is not here.
 */
export interface PlannedOutcome {
  readonly requirementId: string;
  /** The task's words, as the declaring check quoted them; null where it quoted none. */
  readonly quote: string | null;
  /** change: cases the task changes; keep: cases (or a preserve check) whose result stays. */
  readonly role: "change" | "keep";
  /** Every check declared for it, in any version, in the order first declared. */
  readonly declaredBy: readonly string[];
  /**
   * Each version of a check that stated it, in order, with the cases of this role it held then.
   * The launch after D1 replaced the task's own example input with angle-bracket inputs under the
   * same check; only the version that first stated the outcome still showed what was asked.
   */
  readonly statements?: readonly OutcomeStatement[];
}

/**
 * One version of a declared check stating an outcome, and every case it held then, of either role:
 * a version that moves the task's input from a kept case to a changed one still holds it.
 */
export interface OutcomeStatement {
  readonly check: string;
  readonly quote: string | null;
  readonly cases: readonly {
    readonly input: unknown;
    /** The result as the runner prints it for comparison, `{"threw":true}` for a declared throw. */
    readonly expected: string;
    /** The role the case took in that version. */
    readonly role: PlannedOutcome["role"];
  }[];
}
/** The checks and requirements, the coverage reviews and the outcomes the planner declared. */
export type PlannedChecksDeclaration = z.infer<typeof plannedChecksInput> & {
  readonly reviews?: readonly CoverageReviewCall[];
  readonly outcomes?: readonly PlannedOutcome[];
};
type DeclaredCheck = PlannedChecksDeclaration["checks"][number];

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
    .describe(
      "an ES module whose default export is called with each case's input value itself (not the case object) and returns the result",
    ),
  cases: z
    .array(caseSchema)
    .min(1)
    .max(32)
    .describe(
      "each case: input, the value the program's default export is called with, expected, what it must return (or throws: true), and in a change check changed: true or false",
    ),
  why: z.string().min(1).max(2000).describe("how the expected results follow from the task"),
});
export type PlannedCheckCall = z.infer<typeof plannedCheckInput>;

/**
 * A relation's text as a planner writes it: the text itself, or its code points ("U+0020", or
 * "U+000D U+000A" for several). A live planner's space and line feeds reached the harness as
 * empty strings eleven times in one launch: the local server's tool-call parser trims a value
 * that is only whitespace, so a whitespace text has to be able to travel as something else.
 */
export function relationText(written: string): string {
  const trimmed = written.trim();
  return /^U\+[0-9A-Fa-f]{4,6}(?:\s+U\+[0-9A-Fa-f]{4,6})*$/.test(trimmed)
    ? trimmed
        .split(/\s+/)
        .map((one) => String.fromCodePoint(Number.parseInt(one.slice(2), 16)))
        .join("")
    : written;
}

const emptyRelationText =
  "is empty. A text of only whitespace can be dropped on its way here: write it as code points instead, U+0020 for a space, U+0009 for a tab, U+000A for a line feed";
const longRelationText =
  "is the short text inserted into every seed (a few characters, or their code points), not a whole input";
const writtenRelationText = z.string().min(1, emptyRelationText).max(32, longRelationText);

/** One planned relation per call, as one planned check per call, every field at the top level. */
export const plannedRelationInput = z.strictObject({
  id: slug("tab-like-space"),
  purpose: z
    .enum(["change", "preserve"])
    .describe(
      "change: the base does not yet treat the variants like the reference; preserve: it already does",
    ),
  requirementId: slug("separator-rule"),
  requirement: z.string().min(1).max(2000).describe("the requirement this check covers, in words"),
  quote: z
    .string()
    .min(1)
    .max(2000)
    .describe("the task's own words that say the variants behave like the reference"),
  program: z
    .string()
    .min(1)
    .max(16_000)
    .describe("an ES module whose default export takes one input string and returns the result"),
  seeds: relationSchema.shape.seeds.describe(
    "ordinary input strings; the reference and each variant are inserted at every position of each",
  ),
  reference: writtenRelationText.describe(
    "the short text whose behaviour the variants must match, such as a character the task says already works; whitespace as code points, U+0020 for a space",
  ),
  variants: z
    .array(writtenRelationText)
    .min(1, "holds no variant: give the texts that must behave like the reference")
    .max(6)
    .describe(
      "the short texts the task says must behave like the reference; whitespace and invisible characters as code points, such as U+000A",
    ),
  why: z.string().min(1).max(2000).describe("how the task establishes the equivalence"),
});
export type PlannedRelationCall = z.infer<typeof plannedRelationInput>;

/**
 * The declaration so far with one call folded in: the check replaces any of the same id, and
 * the requirement it names takes the call's description, and its quote where the call gives one.
 */
export function withPlannedCheck(
  declaration: PlannedChecksDeclaration | null,
  call: PlannedCheckCall | PlannedRelationCall,
): PlannedChecksDeclaration {
  const check: DeclaredCheck = {
    id: call.id,
    requirement: call.requirementId,
    purpose: call.purpose,
    program: call.program,
    ...("cases" in call
      ? { cases: call.cases }
      : {
          relation: {
            seeds: call.seeds,
            reference: relationText(call.reference),
            variants: call.variants.map(relationText),
          },
        }),
    why: call.why,
  };
  const previous = declaration?.requirements.find((one) => one.id === call.requirementId);
  const quote = call.quote ?? previous?.quote;
  if (quote !== undefined) check.quote = quote;
  const checks = [...(declaration?.checks ?? []).filter((one) => one.id !== call.id), check];
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
  const reviews = (declaration?.reviews ?? []).filter((review) =>
    requirements.some((one) => one.id === review.requirementId),
  );
  return {
    requirements,
    checks,
    ...(reviews.length === 0 ? {} : { reviews }),
    outcomes: withOutcomesOf(declaration?.outcomes ?? [], check),
  };
}

/** The role each case of a declared check takes, as admission reads it from the contract. */
function outcomeRoles(check: DeclaredCheck): readonly PlannedOutcome["role"][] {
  if (check.cases === undefined) return [check.purpose === "change" ? "change" : "keep"];
  const roles = check.cases.map((one) =>
    check.purpose === "change" && one.changed === true ? ("change" as const) : ("keep" as const),
  );
  return [...new Set(roles)];
}

/**
 * Two statements of one outcome compare equal however the quote was typed: case, whitespace,
 * typographic quotation marks, wrapping marks and closing punctuation are folded.
 */
export function outcomeKey(
  outcome: Pick<PlannedOutcome, "requirementId" | "quote" | "role">,
): string {
  return JSON.stringify([outcome.requirementId, foldedQuote(outcome.quote), outcome.role]);
}

/** A quote as outcome identity compares it; null where there is none. */
export function foldedQuote(quote: string | null): string | null {
  return quote === null
    ? null
    : folded(quote)
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/[\s.,;:!]+$/, "");
}

/** The outcomes one declared check states, as keys. */
export function checkOutcomeKeys(check: DeclaredCheck): readonly string[] {
  return outcomeRoles(check).map((role) =>
    outcomeKey({ requirementId: check.requirement, quote: check.quote ?? null, role }),
  );
}

/** A declared check's version as a statement of the outcomes it states. */
function statementOf(check: DeclaredCheck): OutcomeStatement {
  return {
    check: check.id,
    quote: check.quote ?? null,
    cases: (check.cases ?? []).map((one) => ({
      input: one.input,
      expected: expectedResultText(one),
      role: check.purpose === "change" && one.changed === true ? "change" : "keep",
    })),
  };
}

/** The outcomes so far with one more check's added: new ones appended, known ones naming it too. */
function withOutcomesOf(
  outcomes: readonly PlannedOutcome[],
  check: DeclaredCheck,
): readonly PlannedOutcome[] {
  const next = [...outcomes];
  for (const role of outcomeRoles(check)) {
    const stated = { requirementId: check.requirement, quote: check.quote ?? null, role };
    const statement = statementOf(check);
    const at = next.findIndex((one) => outcomeKey(one) === outcomeKey(stated));
    const known = next[at];
    if (known === undefined)
      next.push({ ...stated, declaredBy: [check.id], statements: [statement] });
    else {
      const statements = known.statements ?? [];
      const repeated = statements.some((one) => JSON.stringify(one) === JSON.stringify(statement));
      next[at] = {
        ...known,
        declaredBy: known.declaredBy.includes(check.id)
          ? known.declaredBy
          : [...known.declaredBy, check.id],
        statements: repeated ? statements : [...statements, statement],
      };
    }
  }
  return next;
}

const reviewText = (meaning: string) => z.string().min(1).max(1000).describe(meaning);

/**
 * One behaviour's coverage decision, made before planning finishes: what the task changes, what it
 * keeps, a plausible wrong implementation the cases so far would pass, what tells it apart, and
 * what stays untested. Planners asked six times in one launch to consider a relation wrote more
 * examples at one position and never declared one; here the question is asked of every
 * requirement, and a relation given in the answer is enumerated by the harness through the
 * program of a declared check, so its execution depends on no further tool choice. Where no
 * text-substitution rule applies, the answer says why instead, and none is forced on the task.
 *
 * The harness checks that a review exists for each requirement and that what it names resolves.
 * It cannot check that the wrong implementation is plausible, that the named checks really tell
 * it apart, or that "untested" is complete: those are the planner's words, recorded as such.
 */
export const coverageReviewInput = z.strictObject({
  id: slug("terminator-anywhere"),
  requirementId: slug("separator-rule").describe(
    "the declared requirement this behaviour belongs to",
  ),
  change: reviewText("what the task asks to change in this behaviour; none where it only keeps it"),
  keeps: reviewText("what in this behaviour must stay as it is"),
  wrongImplementation: reviewText(
    "a plausible wrong implementation that would still pass every case declared so far",
  ),
  distinguishedBy: z
    .array(id)
    .max(8)
    .describe(
      "ids of declared checks (or this review's own relation) that tell that wrong implementation apart; empty where none does",
    ),
  relation: z
    .strictObject({
      purpose: plannedRelationInput.shape.purpose,
      programFrom: slug("gettype-terminators").describe(
        "a declared check whose program takes one input string; the relation calls that same program, so the relation and the examples share one adapter and fixture",
      ),
      seeds: plannedRelationInput.shape.seeds,
      reference: plannedRelationInput.shape.reference,
      variants: plannedRelationInput.shape.variants,
    })
    .optional()
    .describe(
      "where the behaviour is a rule that some text behaves like other text: the harness inserts the reference and each variant at every position of each seed and compares their results, as declare_planned_relation does; the relation is sealed under this review's id",
    ),
  noRelation: reviewText(
    "why no rule of some text behaving like other text applies to this behaviour",
  ).optional(),
  untested: reviewText("what of this behaviour no check exercises; none where nothing is left"),
});
export type CoverageReviewCall = z.infer<typeof coverageReviewInput>;

/** What is wrong with a review against the declaration it reviews, each named. */
function reviewProblems(
  declaration: PlannedChecksDeclaration | null,
  call: CoverageReviewCall,
): readonly string[] {
  if (declaration === null || declaration.checks.length === 0)
    return ["declare the checks first; a review names the checks it rests on"];
  const problems: string[] = [];
  const own = declaration.reviews?.find((one) => one.id === call.id);
  const derived = own?.relation === undefined ? null : own.id;
  if (!declaration.requirements.some((one) => one.id === call.requirementId))
    problems.push(`requirement ${call.requirementId} is not declared`);
  for (const named of call.distinguishedBy)
    if (
      !declaration.checks.some((one) => one.id === named) &&
      !(named === call.id && call.relation !== undefined)
    )
      problems.push(`distinguishedBy names ${named}, which is not a declared check`);
  if ((call.relation === undefined) === (call.noRelation === undefined))
    problems.push(
      "give relation or noRelation: a relation the harness enumerates, or why no such rule applies",
    );
  const relation = call.relation;
  if (relation !== undefined) {
    const source = declaration.checks.find((one) => one.id === relation.programFrom);
    if (source === undefined || source.id === derived)
      problems.push(
        `relation.programFrom names ${relation.programFrom}, which is not a declared check`,
      );
    else if ((source.cases ?? []).some((one) => typeof one.input !== "string"))
      problems.push(
        `relation.programFrom names ${source.id}, whose inputs are not strings; a relation calls its program with one input string`,
      );
    if (call.id !== derived && declaration.checks.some((one) => one.id === call.id))
      problems.push(
        `review ${call.id} has the id of a declared check, and its relation is sealed under the review's id: use another id`,
      );
  }
  return problems;
}

/**
 * The declaration with one review folded in, replacing any of the same id, and the relation it
 * gives sealed as a planned relation under the review's id, over the named check's program.
 */
export function withCoverageReview(
  declaration: PlannedChecksDeclaration | null,
  call: CoverageReviewCall,
): PlannedChecksDeclaration {
  const problems = reviewProblems(declaration, call);
  if (declaration === null || problems.length > 0)
    throw new Error(`fix these and review again: ${problems.join("; ")}`);
  const earlier = declaration.reviews?.find((one) => one.id === call.id);
  const kept =
    earlier?.relation === undefined
      ? declaration
      : { ...declaration, checks: declaration.checks.filter((one) => one.id !== call.id) };
  const relation = call.relation;
  const requirement = kept.requirements.find((one) => one.id === call.requirementId);
  const source = kept.checks.find((one) => one.id === relation?.programFrom);
  const withRelation =
    relation === undefined || requirement === undefined || source === undefined
      ? kept
      : withPlannedCheck(kept, {
          id: call.id,
          purpose: relation.purpose,
          requirementId: call.requirementId,
          requirement: requirement.description,
          ...(requirement.quote === undefined ? {} : { quote: requirement.quote }),
          program: source.program,
          seeds: relation.seeds,
          reference: relation.reference,
          variants: relation.variants,
          why: `from coverage review ${call.id}: ${call.wrongImplementation}`.slice(0, 2000),
        } as PlannedRelationCall);
  return {
    ...withRelation,
    reviews: [...(withRelation.reviews ?? []).filter((one) => one.id !== call.id), call],
  };
}

/** The requirements no review covers yet, in declaration order. */
export function unreviewedRequirements(declaration: PlannedChecksDeclaration): readonly string[] {
  const reviewed = new Set((declaration.reviews ?? []).map((one) => one.requirementId));
  return declaration.requirements.filter((one) => !reviewed.has(one.id)).map((one) => one.id);
}

/** What the planner is told about its coverage review while it is incomplete, and once it is not. */
export function describeCoverageReview(declaration: PlannedChecksDeclaration): readonly string[] {
  const missing = unreviewedRequirements(declaration);
  return missing.length === 0
    ? [
        `Coverage review: every requirement has one (${(declaration.reviews ?? []).map((one) => one.id).join(", ")}).`,
      ]
    : [
        `A coverage review is required before planning finishes; no review yet for requirement(s) ${missing.join(", ")}. For each behaviour the task changes or keeps, call declare_coverage_review: what changes, what must stay, a plausible wrong implementation that would pass your cases, which check or relation tells it apart, and what stays untested. Where a rule says some text behaves like other text, give it as relation and the harness tries it at every position through the program of a check you declared; where no such rule applies, say why in noRelation.`,
      ];
}
type PlannedCase = z.infer<typeof caseSchema>;

/**
 * Reads the program and the inputs from stdin, writes the program beside the checkout's root for
 * as long as it takes to import it (so `./` imports resolve from there, as they read), calls its
 * default export once per input, and prints one JSON line per input with object keys sorted.
 * What the program or the project prints is moved to stderr, so stdout carries only results. A
 * thrown case is a result, not a crash: it prints `threw` and its message goes to stderr. Where
 * it was thrown is part of the line when it says something about the check rather than the
 * project: `thrownIn: "check-program"` where the innermost stack frame naming a file is the
 * program's own module (D1's program applied `in` to the string the project returned, and its
 * every case read as the base disagreeing), `thrownIn: "unattributed"` where no frame names a
 * file (a thrown string, a stack the runner cannot read). A throw from any other file, the
 * project or what it calls, keeps the plain line, which is what a declared throw expects. That is
 * where the exception was raised, not whose fault it was: a program that passes the project a
 * wrong argument gets the project's throw, and a project that hides its own frames
 * (`Error.captureStackTrace` with a function) moves the frame to its caller. A
 * program that does not load exits 3, which the harness reads as a check that never ran rather
 * than as a wrong answer. Undefined reads as null wherever it sits, as the tool's description
 * says: dropped from an object instead, a live planner's `{ size: null }` met `{}` and its checks
 * refused every compliant implementation.
 *
 * Given a relation instead of inputs, it calls the program on the reference and on each variant
 * inserted at every position of every seed, and prints one line per seed: `holds` with the number
 * of calls, or the disagreements counted and the first two by position, each with both inputs
 * and both results as the project gave them, and `raisedInProgram` where any call threw in the
 * program's own code. Every line is the harness's reading of the
 * project's own answers; nothing in it is an expected value anyone wrote.
 *
 * The program is called with each case's input itself, never with the case, and the runner adds
 * nothing to the language environment the program and the project run in: no global, no
 * prototype property. An earlier form put `input`, `expected` and `throws` getters on the
 * String, Number and Boolean prototypes to catch a program reading `case_.input` off a string;
 * under it `"input" in Object("hello")` was true where ordinary execution says false, so the
 * check observed a different language than the project's users run. That mistake is diagnosed
 * by `plannedCheckProbe`, a separate run whose answers are never compared. The one deliberate
 * difference from a plain import is where output goes: what is printed moves to stderr.
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
  "const { program, inputs, relation } = JSON.parse(text);",
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
  // Where a case threw, read off the innermost stack frame that names a file: outside the program
  // (the project, its dependencies) is the legacy line, so a declared throw still compares equal;
  // the program's own module, or no file frame at all, is named on the line.
  'const programFile = "/.swarm-check-" + process.pid + ".mjs";',
  "const thrownIn = (error) => {",
  '  const stack = typeof error?.stack === "string" ? error.stack.split("\\n").slice(1) : [];',
  "  for (const line of stack) {",
  "    const found = /\\(((?:file:\\/\\/|\\/)[^()]+?):\\d+:\\d+\\)\\s*$|^\\s*at ((?:file:\\/\\/|\\/)\\S+?):\\d+:\\d+\\s*$/.exec(line);",
  "    const file = found?.[1] ?? found?.[2];",
  "    if (file === undefined) continue;",
  '    if (file.endsWith(programFile)) return { thrownIn: "check-program" };',
  '    return /\\[eval\\d*\\]$/.test(file) ? { thrownIn: "unattributed" } : {};',
  "  }",
  '  return { thrownIn: "unattributed" };',
  "};",
  "const call = async (input, label) => {",
  "  try {",
  "    const result = await run(input);",
  '    return { result: JSON.parse(JSON.stringify(result, (key, value) => (value === undefined ? null : value)) ?? "null") };',
  "  } catch (error) {",
  '    console.error(label + " threw: " + (error?.stack ?? error));',
  "    return { threw: true, ...thrownIn(error) };",
  "  }",
  "};",
  // A result that carries the inserted text (a parser returning the name it was given) is read
  // with the variant written as the reference, so a correct implementation compares equal: the
  // relation is that behaviour commutes with the substitution. Object keys are left as they are.
  "const asReference = (value, variant, reference) =>",
  '  typeof value === "string"',
  "    ? value.split(variant).join(reference)",
  "    : Array.isArray(value)",
  "      ? value.map((one) => asReference(one, variant, reference))",
  '      : value !== null && typeof value === "object"',
  "        ? Object.fromEntries(Object.entries(value).map(([key, one]) => [key, asReference(one, variant, reference)]))",
  "        : value;",
  "if (relation === undefined) {",
  "  for (const [index, input] of inputs.entries())",
  '    write(JSON.stringify(plain({ input, ...(await call(input, "case " + (index + 1))) })) + "\\n");',
  "} else {",
  "  const { seeds, reference, variants } = relation;",
  "  for (const seed of seeds) {",
  "    let ran = 0;",
  "    let disagreements = 0;",
  // Calls thrown in the program's own code compare equal to each other, so a relation whose
  // program throws everywhere would hold everywhere; their count is on the line where any were.
  "    let raised = 0;",
  "    const counterexamples = [];",
  "    for (let at = 0; at <= seed.length; at += 1) {",
  "      const place = (text) => seed.slice(0, at) + text + seed.slice(at);",
  '      const label = "seed " + JSON.stringify(seed) + " at " + at;',
  "      const expected = await call(place(reference), label);",
  "      ran += 1;",
  '      if (expected.thrownIn === "check-program") raised += 1;',
  "      for (const variant of variants) {",
  "        const got = await call(place(variant), label);",
  "        ran += 1;",
  '        if (got.thrownIn === "check-program") raised += 1;',
  "        if (JSON.stringify(plain(asReference(got, variant, reference))) === JSON.stringify(plain(expected))) continue;",
  "        disagreements += 1;",
  `        if (counterexamples.length < ${relationCounterexamples})`,
  "          counterexamples.push({ at, reference: { input: place(reference), ...expected }, variant: { input: place(variant), ...got } });",
  "      }",
  "    }",
  "    const counted = raised === 0 ? {} : { raisedInProgram: raised };",
  '    write(JSON.stringify(plain(disagreements === 0 ? { holds: true, ran, seed, ...counted } : { counterexamples, disagreements, holds: false, ran, seed, ...counted })) + "\\n");',
  "  }",
  "}",
].join("\n");

/** What a program that never loaded exits with, which admission reads as a check that never ran. */
export const programDidNotLoad = 3;

/**
 * A diagnostic run of a planned check's program, apart from the check: did the program's own code
 * read a case's field (`input`, `expected`, `throws`) off the string, number or boolean it was
 * called with? A live planner's programs read `case_.input` off the string they were given and
 * passed undefined to the project for every case. To see that read, this run puts getters for the
 * three names on the String, Number and Boolean prototypes, which changes what the program and
 * the project observe (`"input" in Object("x")` becomes true), so its answers are not the
 * project's and are never compared with anything. It prints one line, the reads it saw, each
 * attributed by the frame that made it (the program's module, not the project's), and exits 0.
 * A program that reads the field and copes with its absence (`case_.input ?? case_`) is reported
 * too; what the reading means is decided beside the check's own run, never by this one.
 */
export const plannedCheckProbe = [
  'import { rmSync, writeFileSync } from "node:fs";',
  'import { resolve } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  "const write = process.stdout.write.bind(process.stdout);",
  "process.stdout.write = process.stderr.write.bind(process.stderr);",
  'let text = "";',
  "for await (const chunk of process.stdin) text += chunk;",
  "const { program, inputs, relation } = JSON.parse(text);",
  'const path = resolve(".swarm-probe-" + process.pid + ".mjs");',
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
  'if (typeof run !== "function") process.exit(3);',
  "const programUrl = pathToFileURL(path).href;",
  "const misread = [];",
  "let calling = null;",
  "for (const prototype of [String.prototype, Number.prototype, Boolean.prototype])",
  '  for (const field of ["input", "expected", "throws"])',
  "    Object.defineProperty(prototype, field, {",
  "      configurable: true,",
  "      get() {",
  "        if (",
  "          calling !== null &&",
  "          Object.is(this, calling.input) &&",
  '          (new Error().stack ?? "").split("\\n")[2]?.includes(programUrl)',
  "        )",
  "          misread.push({ label: calling.label, field, input: calling.input });",
  "        return undefined;",
  "      },",
  "    });",
  // A relation's program is called on its seeds as written, enough to see how it reads its input.
  "const called = relation === undefined",
  '  ? inputs.map((input, index) => ({ input, label: "case " + (index + 1) }))',
  '  : relation.seeds.map((input) => ({ input, label: "seed " + JSON.stringify(input) }));',
  "for (const one of called) {",
  "  calling = one;",
  "  try {",
  "    await run(one.input);",
  "  } catch {}",
  "  calling = null;",
  "}",
  'write(JSON.stringify({ calls: called.length, misread: misread.slice(0, 8) }) + "\\n");',
].join("\n");

/** A read the probe saw the program make of a case's field off the primitive it was given. */
export interface ProgramMisread {
  readonly label: string;
  readonly field: string;
  readonly input: unknown;
}

/** The reads a probe's stdout reports, or null where it did not run to its report. */
export function probeMisreads(stdout: string): readonly ProgramMisread[] | null {
  try {
    const read = JSON.parse(stdout.trim()) as { misread?: unknown };
    return Array.isArray(read.misread) ? (read.misread as ProgramMisread[]) : null;
  } catch {
    return null;
  }
}

/** Each probe read in words, with what the probe is, so a reader can weigh it. */
export function describeMisreads(misread: readonly ProgramMisread[]): readonly string[] {
  return [
    ...misread
      .slice(0, 3)
      .map(
        (one) =>
          `the program read .${one.field} of the value it was called with in ${one.label}, but that value is the case's input itself, ${inputAsRead(one.input)}, a ${typeof one.input}, not the case: the program receives the input, not { input, expected }`,
      ),
    "(seen by a separate diagnostic run that adds getters for input, expected and throws to the String, Number and Boolean prototypes; its answers are never compared, and a program that tests for those properties behaves differently there)",
  ];
}

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

/**
 * A case's expected result as admission reads a runner line: the result's JSON with the runner's
 * key order, or `{"threw":true}`. The base's answer in a recorded disagreement is in this form.
 */
export function expectedResultText(one: PlannedCase): string {
  return "throws" in one
    ? JSON.stringify({ threw: true })
    : (JSON.stringify(plain(one.expected)) ?? "null");
}

function expectedLine(one: PlannedCase): string {
  return `${JSON.stringify(plain("throws" in one ? { input: one.input, threw: true } : { input: one.input, result: one.expected }))}\n`;
}

/** How many of a relation run's calls threw in the check program's own code, over every seed. */
export function relationRaisedInProgram(stdout: string): number {
  const counted = (line: string): number => {
    try {
      const read = JSON.parse(line) as { raisedInProgram?: unknown };
      return typeof read.raisedInProgram === "number" ? read.raisedInProgram : 0;
    } catch {
      return 0;
    }
  };
  return stdout
    .split("\n")
    .filter((one) => one.length > 0)
    .reduce((total, line) => total + counted(line), 0);
}

/**
 * Where the case a runner line reports was thrown, as the runner read its stack: in the check
 * program's own module, outside it (the project or what it calls), or nowhere a frame names. Null
 * for a line that reports an answer, or that the runner did not write.
 */
export function thrownIn(
  line: string,
): "check-program" | "outside-program" | "unattributed" | null {
  try {
    const read = JSON.parse(line) as { threw?: unknown; thrownIn?: unknown };
    if (read.threw !== true) return null;
    return read.thrownIn === "check-program" || read.thrownIn === "unattributed"
      ? read.thrownIn
      : "outside-program";
  } catch {
    return null;
  }
}

const stdoutLimit = 64_000;
const stdinLimit = 64_000;

/** How many calls a relation makes: the reference and each variant at every position of each seed. */
export function relationCalls(relation: PlannedRelation): number {
  return relation.seeds.reduce(
    (total, seed) => total + (seed.length + 1) * (relation.variants.length + 1),
    0,
  );
}

/** A relation's expected output: every seed holds, with the number of calls the runner makes. */
function relationLines(relation: PlannedRelation): string {
  return relation.seeds
    .map(
      (seed) =>
        `${JSON.stringify(plain({ holds: true, ran: (seed.length + 1) * (relation.variants.length + 1), seed }))}\n`,
    )
    .join("");
}

function contractCheck(check: DeclaredCheck): GoalCheckDefinition {
  const { relation } = check;
  const cases = check.cases ?? [];
  return {
    id: check.id,
    // Shown where criteria are listed; the behavior below is what runs.
    command:
      relation === undefined
        ? `planned check: ${cases.length} case(s) through the default export of its program`
        : `planned relation: ${JSON.stringify(relation.reference)} and ${relation.variants.length} variant(s) at every position of ${relation.seeds.length} seed(s), ${relationCalls(relation)} call(s) through the default export of its program`,
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
      // A change check's case roles travel with its inputs, which the runner ignores, so the
      // check's identity names them and admission and the gate read them from the check itself.
      stdin: JSON.stringify(
        relation === undefined
          ? {
              program: check.program,
              inputs: cases.map((one) => one.input),
              ...(check.purpose === "change"
                ? { changed: cases.map((one) => one.changed === true) }
                : {}),
            }
          : { program: check.program, relation },
      ),
      exitCode: 0,
      stdout: [
        {
          kind: "equals",
          value:
            relation === undefined ? cases.map(expectedLine).join("") : relationLines(relation),
        },
      ],
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
    if ((check.cases === undefined) === (check.relation === undefined))
      problems.push(`check ${check.id}: give either cases or a relation, not both or neither`);
    const relation = check.relation;
    if (relation !== undefined) {
      for (const [label, text] of [
        ["the reference", relation.reference],
        ...relation.variants.map((one, index) => [`variant ${index + 1}`, one] as const),
      ] as const)
        if (text.length === 0 || text.length > 4)
          problems.push(
            `check ${check.id}: ${label} ${text.length === 0 ? emptyRelationText : `is ${text.length} characters as read; it ${longRelationText}`}`,
          );
      if (relation.variants.includes(relation.reference))
        problems.push(
          `check ${check.id}: a variant equals the reference, so it compares the reference with itself`,
        );
      if (new Set(relation.seeds).size !== relation.seeds.length)
        problems.push(`check ${check.id}: a seed is listed twice`);
    }
    const cases = check.cases ?? [];
    if (check.purpose === "change" && cases.length > 0) {
      const unstated = cases.flatMap((one, index) =>
        one.changed === undefined ? [index + 1] : [],
      );
      if (unstated.length > 0)
        problems.push(
          `check ${check.id}: say for case(s) ${unstated.join(", ")} whether the task changes the result (changed: true) or keeps it, so the unchanged base already gives the expected result (changed: false)`,
        );
      else if (!cases.some((one) => one.changed === true))
        problems.push(
          `check ${check.id} is a change check with no case the task changes (changed: true); make it a preserve check or add one`,
        );
    }
    if (check.purpose === "preserve" && cases.some((one) => one.changed === true))
      problems.push(
        `check ${check.id} is a preserve check, which holds only cases the task keeps; move the changed cases to a change check`,
      );
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
  problems.push(...conflictingExpectations(input));
  return problems;
}

/**
 * One input given two different expectations through the same program, which no implementation
 * can satisfy: where one of them is a kept case, the other contradicts behaviour the task keeps.
 */
function conflictingExpectations(input: PlannedChecksDeclaration): readonly string[] {
  const seen = new Map<string, { label: string; outcome: string }>();
  const problems: string[] = [];
  for (const check of input.checks)
    (check.cases ?? []).forEach((one, index) => {
      const key = JSON.stringify([check.program, one.input]);
      const outcome = JSON.stringify("throws" in one ? { threw: true } : { result: one.expected });
      const label = `check ${check.id} case ${index + 1}`;
      const earlier = seen.get(key);
      if (earlier === undefined) seen.set(key, { label, outcome });
      else if (earlier.outcome !== outcome)
        problems.push(
          `${label} expects ${outcome} for ${inputAsRead(one.input)} through the same program for which ${earlier.label} expects ${earlier.outcome}; one input has one result`,
        );
    });
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

/** The relation a built planned check enumerates, or null for a check of cases or any other check. */
export function plannedRelation(check: GoalCheckDefinition): PlannedRelation | null {
  const parsed = relationSchema.safeParse(
    (carried(check) as { relation?: unknown } | null)?.relation,
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Whether any comparison of a relation agreed in a run's output: a seed that held, or one whose
 * disagreements are fewer than its comparisons. A relation's control is that the base treats a
 * variant like the reference somewhere, which a program that does not observe the project
 * correctly (one that reports which text it was given, say) cannot show.
 */
export function relationAgreedSomewhere(relation: PlannedRelation, stdout: string): boolean {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .some((line) => {
      try {
        const read = JSON.parse(line) as {
          holds?: unknown;
          disagreements?: unknown;
          seed?: unknown;
        };
        if (read.holds === true) return true;
        const seed = typeof read.seed === "string" ? read.seed : null;
        return (
          seed !== null &&
          typeof read.disagreements === "number" &&
          read.disagreements < (seed.length + 1) * relation.variants.length
        );
      } catch {
        return false;
      }
    });
}

/**
 * A relation's run in words, for the worker it refused: each seed that broke the relation, how
 * many comparisons disagreed, and its first counterexamples with both inputs and both results.
 * Inputs are written with invisible characters escaped, as the harness read them.
 */
export function describeRelationRun(relation: PlannedRelation, stdout: string): readonly string[] {
  const lines: string[] = [];
  for (const text of stdout.split("\n").filter((line) => line.length > 0)) {
    let read: {
      holds?: unknown;
      seed?: unknown;
      disagreements?: unknown;
      counterexamples?: readonly {
        at?: unknown;
        reference?: { input?: unknown; result?: unknown; threw?: unknown; thrownIn?: unknown };
        variant?: { input?: unknown; result?: unknown; threw?: unknown; thrownIn?: unknown };
      }[];
    };
    try {
      read = JSON.parse(text);
    } catch {
      lines.push(`an output line the runner did not write: ${text.slice(0, 200)}`);
      continue;
    }
    if (read.holds === true || typeof read.seed !== "string") continue;
    const comparisons = (read.seed.length + 1) * relation.variants.length;
    lines.push(
      `seed ${inputAsRead(read.seed)}: ${String(read.disagreements)} of ${comparisons} comparisons disagreed`,
    );
    const answer = (side: { result?: unknown; threw?: unknown; thrownIn?: unknown } | undefined) =>
      side?.threw !== true
        ? `gave ${inputAsRead(side?.result ?? null)}`
        : side.thrownIn === "check-program"
          ? "threw in the check program's own code"
          : side.thrownIn === "unattributed"
            ? "threw where no stack frame names a file"
            : "threw";
    for (const one of read.counterexamples ?? [])
      lines.push(
        `  at position ${String(one.at)}: ${inputAsRead(one.variant?.input)} ${answer(one.variant)}, where ${inputAsRead(one.reference?.input)} ${answer(one.reference)}`,
      );
  }
  return lines;
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

/**
 * Each case's declared role, in case order: whether the task changes its result. Every case of a
 * preserve check is kept. Null for a relation, any other check, and a change check sealed before
 * cases declared a role, whose cases were never told apart.
 */
export function plannedCaseRoles(
  check: GoalCheckDefinition,
): readonly ("changed" | "kept")[] | null {
  const inputs = plannedInputs(check);
  if (inputs === null) return null;
  if (check.atBase === "passes") return inputs.map(() => "kept");
  const roles = (carried(check) as { changed?: unknown } | null)?.changed;
  return Array.isArray(roles) && roles.length === inputs.length
    ? roles.map((one) => (one === true ? "changed" : "kept"))
    : null;
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
    const relation = check.relation;
    const values: readonly { readonly label: string; readonly value: unknown }[] =
      relation === undefined
        ? (check.cases ?? []).map((one, index) => ({
            label: `case ${index + 1}`,
            value: one.input,
          }))
        : [
            ...relation.seeds.map((seed, index) => ({ label: `seed ${index + 1}`, value: seed })),
            { label: "the reference", value: relation.reference },
            ...relation.variants.map((variant, index) => ({
              label: `variant ${index + 1}`,
              value: variant,
            })),
          ];
    lines.push(
      relation === undefined
        ? `${check.id} inputs as read: ${values.map((one) => inputAsRead(one.value)).join(", ")}`
        : `${check.id} as read: seeds ${relation.seeds.map(inputAsRead).join(", ")}; reference ${inputAsRead(relation.reference)}; variants ${relation.variants.map(inputAsRead).join(", ")}; ${relationCalls(relation)} call(s), each variant compared with the reference at every position of every seed`,
    );
    for (const { label, value } of values) {
      const escaped = stringsIn(value).find((text) => /\\[nrtu]/.test(text));
      if (escaped !== undefined)
        lines.push(
          `warning: ${check.id} ${label} holds a backslash followed by ${/\\([nrtu])/.exec(escaped)?.[1]}, which is two characters, not a line terminator or tab. If you meant the control character, write it inside the JSON string with one backslash (\\n) and declare again; if the backslash is meant, leave it.`,
        );
    }
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
