import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type Requirement, type SealedFile, sealFiles, structureEvidence } from "swarm-verify";
import { z } from "zod";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { type AuthorKind, authorPrompt, authorRequest, parseAuthor } from "./author-prompt.ts";
import { estimateTokens } from "./context.ts";
import { type Message, type ModelClient, ModelError } from "./model.ts";
import type { TestConventions } from "./test-conventions.ts";

type StructureClaim = Requirement["evidence"]["structure"][number];

/** One authored check, held in memory for the harness to lay into the tree while it runs. */
export interface AuthoredTest {
  readonly requirement: string;
  readonly path: string;
  readonly command: string;
  readonly content: string;
  /** The end of what it printed at the base, where it failed as it should. */
  readonly atBase: string;
}

/** What the check-authoring stage produced for one requirement, and why where it produced nothing. */
export interface Authored {
  readonly requirement: string;
  readonly kind: AuthorKind | null;
  readonly test: AuthoredTest | null;
  readonly structure: readonly StructureClaim[];
  /** Why no independent check exists for the requirement; null where one does. */
  readonly failure: string | null;
  /** Each attempt's reasons for rejection, in order; an accepted attempt has none. */
  readonly attempts: readonly (readonly string[])[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

const claimSchema = z.strictObject({
  path: z.string().min(1),
  symbol: z
    .string()
    .regex(/^[A-Za-z_$][\w$]*$/)
    .optional(),
  provides: z.boolean().optional(),
  contains: z.string().min(1).optional(),
  absent: z.boolean().optional(),
});

const excerpt = (text: string) => text.slice(-1500);
const notCollected =
  /No test files found|no tests ran|collected 0 items|file or directory not found|No tests found/i;
// Node reports an export the base lacks as a SyntaxError too; that is the failure a feature's
// check should have, not a check that does not parse.
const unparsable = /(?:SyntaxError|IndentationError)(?!: The requested module)|Transform failed/;
const missingModule =
  /Failed to load url (\S+)|Cannot find module '([^']+)'|No module named '([^']+)'/g;

/**
 * A module the check imports that the base lacks and the task does not name: it fails at the
 * base for a reason no correct change would remove. A module the task names (a new file it asks
 * for) is the change's to create.
 */
export function unrelatedImport(output: string, task: string): string | null {
  for (const match of output.matchAll(missingModule)) {
    const spec = match[1] ?? match[2] ?? match[3] ?? "";
    const stem =
      spec
        .split(/[/.]/)
        .filter((part) => /^\w+$/.test(part) && part !== "js" && part !== "ts")
        .at(-1) ?? spec;
    if (stem.length > 0 && !task.includes(stem)) return spec;
  }
  return null;
}

/** Runs an authored test file at the base: laid in, run by the harness, taken out again. */
async function runAtBase(
  chokepoint: Chokepoint,
  workspace: string,
  test: Omit<AuthoredTest, "atBase">,
  task: string,
): Promise<{ readonly reasons: string[]; readonly output: string }> {
  const absolute = join(workspace, test.path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, test.content);
  const ran = await chokepoint
    .check(test.command, `authored check for ${test.requirement}, at the base`)
    .finally(() => removeLaid(workspace, test.path));
  const output = excerpt(ran.output);
  if (ran.decision !== "allowed") return { reasons: [`it could not run: ${output}`], output };
  if (ran.exitCode === 0)
    return { reasons: ["it passes at the base, so it cannot tell the change apart"], output };
  if (notCollected.test(ran.output))
    return { reasons: [`the runner did not collect it: ${output}`], output };
  if (unparsable.test(ran.output) && ran.output.includes(basename(test.path)))
    return { reasons: [`it does not parse: ${output}`], output };
  const missing = unrelatedImport(ran.output, task);
  if (missing !== null)
    return {
      reasons: [
        `it imports ${missing}, which does not exist at the base and which the task does not ask for; import from the modules listed as defining the task's names`,
      ],
      output,
    };
  return { reasons: [], output };
}

/** Takes a laid check out of the tree, with any bytecode its run left beside it. */
export async function removeLaid(workspace: string, path: string): Promise<void> {
  await rm(join(workspace, path), { force: true });
  const stem = basename(path).replace(/\.py$/, "");
  const cache = join(workspace, dirname(path), "__pycache__");
  const left = await readdir(cache).catch(() => [] as string[]);
  for (const name of left) if (name.startsWith(`${stem}.`)) await rm(join(cache, name));
}

/** Claims that do not hold at the base tell the refactor apart; one that holds already does not. */
async function claimsAtBase(
  workspace: string,
  raw: readonly unknown[],
): Promise<{ readonly kept: StructureClaim[]; readonly reasons: string[] }> {
  const kept: StructureClaim[] = [];
  const reasons: string[] = [];
  for (const entry of raw) {
    const parsed = claimSchema.safeParse(entry);
    if (!parsed.success) {
      reasons.push(
        `a claim is not {"path", "symbol", "absent"?, "provides"?}: ${JSON.stringify(entry)}`,
      );
      continue;
    }
    const claim = { ...parsed.data, authority: "independently-generated" as const };
    const read = await structureEvidence(workspace, claim);
    if (read.outcome === "observed") reasons.push(`${read.ref} already holds at the base`);
    else kept.push(claim);
  }
  if (kept.length === 0) reasons.unshift("no claim fails at the base");
  return { kept, reasons: kept.length === 0 ? reasons : [] };
}

/**
 * The check-authoring stage for one requirement: a fresh-context call that sees the requirement
 * and the repository's test conventions, never a diff, then the harness's run of what it wrote
 * at the base. A check that passes there is rejected and the author tries once more with why.
 */
export async function authorChecks(input: {
  readonly model: ModelClient;
  readonly chokepoint: Chokepoint;
  readonly evidence: EvidenceRecorder;
  readonly workspace: string;
  readonly requirement: Requirement;
  readonly conventions: TestConventions | null;
  readonly turnTokens: number;
  readonly signal?: AbortSignal | undefined;
}): Promise<Authored> {
  const { requirement, conventions } = input;
  const path = conventions?.pathFor(requirement.id) ?? null;
  const command = path === null ? null : (conventions?.commandFor(path) ?? null);
  const messages: Message[] = [
    { role: "system", content: authorPrompt },
    { role: "user", content: authorRequest(requirement, conventions) },
  ];
  const attempts: string[][] = [];
  let tokens = { inputTokens: 0, outputTokens: 0 };
  let kind: AuthorKind | null = null;
  const done = (rest: Partial<Authored>): Authored => ({
    requirement: requirement.id,
    kind,
    test: null,
    structure: [],
    failure: null,
    attempts,
    ...tokens,
    ...rest,
  });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let content: string;
    try {
      const reply = await input.model.complete(messages, {
        signal: input.signal,
        maxTokens: input.turnTokens,
      });
      content = reply.content.trim().length > 0 ? reply.content : (reply.reasoning ?? "");
      tokens = {
        inputTokens:
          tokens.inputTokens +
          (reply.inputTokens ?? estimateTokens(messages.map((one) => one.content).join(""))),
        outputTokens: tokens.outputTokens + (reply.outputTokens ?? estimateTokens(content)),
      };
      await input.evidence.record({
        type: "model-call",
        actor: input.model.model,
        provenance: ["model"],
        payload: { author: requirement.id, attempt, reply: content, ...tokens },
      });
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      return done({ failure: `the check author's model failed: ${error.message}` });
    }
    const parsed = parseAuthor(content);
    kind = parsed.kind ?? kind;
    const reasons: string[] = parsed.problem === null ? [] : [parsed.problem];
    let accepted: Partial<Authored> | null = null;
    if (parsed.kind === "upgrade") {
      accepted =
        requirement.versions.length > 0
          ? {}
          : { failure: "no version constraint could be read from the task's wording" };
    } else if (parsed.kind === "refactor") {
      const read = await claimsAtBase(input.workspace, parsed.claims ?? []);
      reasons.push(...read.reasons);
      if (parsed.claims === null) reasons.push("the reply has no ```claims block");
      if (reasons.length === 0) accepted = { structure: read.kept };
    } else if (parsed.kind !== null) {
      if (path === null || command === null)
        accepted = { failure: "no test runner was recognized, so no authored test can run" };
      else if (parsed.test === null) reasons.push("the reply has no ```test block");
      else {
        const test = { requirement: requirement.id, path, command, content: parsed.test };
        const ran = await runAtBase(input.chokepoint, input.workspace, test, requirement.text);
        reasons.push(...ran.reasons);
        if (ran.reasons.length === 0) accepted = { test: { ...test, atBase: ran.output } };
      }
    }
    attempts.push(reasons);
    if (accepted !== null && reasons.length === 0) {
      const authored = done(accepted);
      await recordAuthored(input.evidence, authored);
      return authored;
    }
    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content: `The harness rejected that: ${reasons.join("; ")}. Reply again in the same form.`,
      },
    );
  }
  const authored = done({
    failure: `the check author's two attempts were rejected: ${attempts.at(-1)?.join("; ") ?? ""}`,
  });
  await recordAuthored(input.evidence, authored);
  return authored;
}

async function recordAuthored(evidence: EvidenceRecorder, authored: Authored): Promise<void> {
  await evidence.record({
    type: "authored-checks",
    actor: "harness",
    provenance: ["harness", "tool-output"],
    payload: {
      requirement: authored.requirement,
      kind: authored.kind,
      test:
        authored.test === null
          ? null
          : { path: authored.test.path, command: authored.test.command },
      structure: JSON.parse(JSON.stringify(authored.structure)),
      failure: authored.failure,
      attempts: authored.attempts.map((reasons) => [...reasons]),
    },
  });
}

/**
 * Seals the authored tests outside the candidate's tree, where the verifier runs them as
 * independently generated checks bound to their requirements. Nothing is sealed where none exist.
 */
export async function sealAuthored(
  workspace: string,
  authored: readonly Authored[],
  home: string,
): Promise<void> {
  const tests = authored.flatMap((one) => (one.test === null ? [] : [one.test]));
  if (tests.length === 0) return;
  const files: SealedFile[] = tests.map((test) => ({ path: test.path, content: test.content }));
  await sealFiles({
    workspace,
    home,
    authority: "independently-generated",
    files,
    checks: tests.map((test) => ({
      name: `authored-${test.requirement}`,
      command: test.command,
      kind: "test" as const,
      requirements: [test.requirement],
    })),
  });
}
