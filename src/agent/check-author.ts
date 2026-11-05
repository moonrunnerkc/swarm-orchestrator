import { type Requirement, type SealedFile, sealFiles } from "swarm-verify";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { type AuthorKind, authorPrompt, authorRequest, parseAuthor } from "./author-prompt.ts";
import { claimsAtBase } from "./authored-claims.ts";
import { runAtBase } from "./authored-validation.ts";
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
  /** Its cases left out by name, since they failed at the base on errors of their own. */
  readonly excluded?: readonly string[];
}

/** What the check-authoring stage produced for one requirement, and why where it produced nothing. */
export {
  foreignError,
  ownUndefinedName,
  plainOutput,
  raisedNotAsserted,
  removeLaid,
  unrelatedImport,
} from "./authored-validation.ts";

export interface Authored {
  readonly requirement: string;
  readonly kind: AuthorKind | null;
  readonly test: AuthoredTest | null;
  readonly structure: readonly StructureClaim[];
  /**
   * An upgrade whose author found a code change to check beside the versions: it wrote a test
   * block in some attempt, accepted or not. The verifier then holds R1 to a test of the change.
   */
  readonly behaviorAsked: boolean;
  /** Why no independent check exists for the requirement; null where one does. */
  readonly failure: string | null;
  /** Each attempt's reasons for rejection, in order; an accepted attempt has none. */
  readonly attempts: readonly (readonly string[])[];
  readonly inputTokens: number;
  readonly outputTokens: number;
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
  let behaviorAsked = false;
  const done = (rest: Partial<Authored>): Authored => ({
    requirement: requirement.id,
    kind,
    test: null,
    structure: [],
    behaviorAsked,
    failure: null,
    attempts,
    ...tokens,
    ...rest,
  });
  // One retry with the reason, and a third only where the second was refused for a new one: a
  // check that cannot run hides its next fault until the first is gone (pubprep, 2026-11-05).
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt === 3 && attempts[0]?.join("; ") === attempts[1]?.join("; ")) break;
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
    if (parsed.kind === "upgrade" && parsed.test !== null) behaviorAsked = true;
    if (parsed.kind === "upgrade" && parsed.test === null) {
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
        const ran = await runAtBase(
          input.chokepoint,
          input.workspace,
          test,
          requirement.text,
          parsed.kind,
        );
        reasons.push(...ran.reasons);
        if (ran.reasons.length === 0)
          accepted = {
            test: {
              ...test,
              command: ran.command ?? test.command,
              atBase: ran.output,
              ...(ran.excluded === undefined ? {} : { excluded: ran.excluded }),
            },
          };
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
    failure: `the check author's ${attempts.length} attempts were rejected: ${attempts.at(-1)?.join("; ") ?? ""}`,
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
