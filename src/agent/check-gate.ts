import type { Requirement, TrustedCheck } from "swarm-verify";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { type Authored, authorChecks, sealAuthored } from "./check-author.ts";
import { type CheckReviewer, review, writeOut } from "./check-review.ts";
import type { ModelClient } from "./model.ts";
import { type RequirementRecord, withAuthored } from "./requirement-record.ts";
import type { Supplied } from "./supplied.ts";
import { testConventions } from "./test-conventions.ts";
import { createTurnChecks, type TurnChecks } from "./turn-checks.ts";
import { sealUserChecks, type UserCheck, validateSupplied } from "./user-checks.ts";

type Test = NonNullable<Authored["test"]>;

/**
 * What happens to the checks the author writes: used as written (`--accept-authored`), shown to
 * the user to approve, edit or reject (`--review-checks`), or written out for the user to edit and
 * supply with `--accept` (`--write-checks`), where the run stops before its first edit.
 */
export type ChecksMode =
  | { readonly kind: "accept-authored" }
  | { readonly kind: "review"; readonly reviewer: CheckReviewer }
  | { readonly kind: "write"; readonly directory: string };

export interface CheckGate {
  readonly record: RequirementRecord;
  readonly authored: readonly Authored[];
  readonly user: readonly UserCheck[];
  readonly trusted: readonly TrustedCheck[];
  readonly checks: TurnChecks;
  /** Why the run stops before its first edit; null where it goes on. */
  readonly blocked: string | null;
  /** Obligations left with no independent check, each with why and how to supply one. */
  readonly notes: readonly string[];
}

const runAgain = (task: string, what: string) => `swarm run ${JSON.stringify(task)} ${what}`;

/**
 * Between recording the requirements and the first edit. Each required requirement, the task and
 * every obligation set apart in it, gets its checks: the user's where supplied, validated at the
 * base, else the author's, written by a fresh-context call that never sees the change, then
 * reviewed or written out as the mode says, and sealed outside the tree. Where the task itself is
 * left with no independent check and no failing base test a change could make pass, the run stops
 * here: nothing it could do would be shown met. An obligation left without one is named in the
 * report and stays unverified.
 */
export async function checkGate(input: {
  readonly model: ModelClient;
  readonly chokepoint: Chokepoint;
  readonly evidence: EvidenceRecorder;
  readonly workspace: string;
  readonly task: string;
  readonly record: RequirementRecord;
  readonly home: string;
  readonly turnTokens: number;
  readonly scratch: string;
  readonly supplied: readonly Supplied[];
  readonly mode: ChecksMode;
  readonly behaviorChangeAuthorized: boolean;
  readonly signal?: AbortSignal | undefined;
}): Promise<CheckGate> {
  const conventions = await testConventions(input.workspace, input.task);
  const required = input.record.requirements.filter((one) => one.required);
  const ids = new Set(required.map((one) => one.id));
  const unknown = input.supplied.filter(
    (one) => one.requirement !== null && !ids.has(one.requirement),
  );
  const validated = await validateSupplied({ ...input, conventions });
  const user: UserCheck[] = [...validated.checks];
  let claims = [...validated.claims];
  let blocked: string | null =
    unknown.length > 0
      ? `a check was supplied for ${unknown[0]?.requirement}, which this task does not have; its requirements are ${required.map(described).join(", ")}. Set a part of the task apart with --require "<its words>" to give it a check of its own`
      : validated.refused.length > 0
        ? `your checks were refused: ${validated.refused.join("; ")}`
        : null;

  // The author writes for every required requirement the user supplied nothing for.
  const authored: Authored[] = [];
  if (blocked === null)
    for (const requirement of required) {
      const covered =
        claims.some((one) => one.requirement === requirement.id) ||
        user.some((one) => one.requirement === requirement.id);
      if (!covered)
        authored.push(await authorChecks({ ...input, requirement, conventions, task: input.task }));
    }
  let unreviewed = authored.flatMap((one) => (one.test === null ? [] : [one.test]));
  let structure = authored.flatMap((one) =>
    one.structure.map((claim) => ({ requirement: one.requirement, claim })),
  );

  const produced = unreviewed.length > 0 || structure.length > 0;
  if (blocked === null && produced && input.mode.kind === "write") {
    const written = await writeOut(input.mode.directory, unreviewed, structure);
    blocked = `the check author's checks were written to ${input.mode.directory} (${written.join(", ")}) for you to read and edit; then run ${runAgain(input.task, `--accept ${input.mode.directory}`)}`;
  } else if (blocked === null && produced && input.mode.kind === "review") {
    const reviewed = await review(input, input.mode.reviewer, unreviewed, structure, conventions);
    user.push(...reviewed.user);
    claims = [...claims, ...reviewed.claims];
    unreviewed = [];
    structure = [];
  }
  if (blocked === null && unreviewed.length > 0 && user.some((one) => one.path !== null))
    blocked =
      "an authored check nobody reviewed cannot be sealed beside your own: review it with --review-checks, or write it out with --write-checks";

  const trusted = blocked === null ? await sealed(input, user, unreviewed, authored) : [];
  let record = input.record;
  for (const requirement of required) {
    const author = authored.find((one) => one.requirement === requirement.id);
    const own = [...claims, ...structure]
      .filter((one) => one.requirement === requirement.id)
      .map((one) => one.claim);
    const names = trusted
      .filter((one) => user.some((u) => u.name === one.name && u.requirement === requirement.id))
      .map((one) => one.name);
    const kind = author?.kind ?? null;
    if (kind === null && own.length === 0 && names.length === 0) continue;
    record = withAuthored(
      record,
      kind ?? requirement.kind,
      own,
      author?.behaviorAsked ?? false,
      names,
      requirement.id,
    );
  }
  const checks = createTurnChecks({
    chokepoint: input.chokepoint,
    workspace: input.workspace,
    authored: unreviewed,
    scratch: input.scratch,
    conventions,
    user,
  });
  // A run cancelled while its checks were written is cancelled, not blocked for want of them.
  input.signal?.throwIfAborted();
  const gate = { record, authored, user, trusted, checks };
  if (blocked !== null) return { ...gate, blocked, notes: [] };
  // Still the base: what the declared tests do before any edit, for regressions to be read from.
  await checks.baseline();
  input.signal?.throwIfAborted();
  const independent = (id: string) => {
    const held = record.requirements.find((one) => one.id === id);
    return (
      user.some((one) => one.requirement === id) ||
      unreviewed.some((one) => one.requirement === id) ||
      (held?.evidence.structure ?? []).some(
        (claim) => claim.authority !== "implementation-authored",
      ) ||
      ((held?.versions.length ?? 0) > 0 && held?.behaviorAsked !== true)
    );
  };
  const why = (id: string) =>
    authored.find((one) => one.requirement === id)?.failure ??
    "the reviewed checks were all rejected";
  // A failing base test a change makes pass is independent, as is, where the user authorized a
  // behavior change, a passing one whose expectation the change supersedes.
  if (
    !independent("R1") &&
    !checks.baseFailing(bearsOn(input.task)) &&
    !input.behaviorChangeAuthorized
  )
    blocked = `no independent check for R1 (${why("R1")}), and no test fails at the base for a change to make pass; supply one that fails today: ${runAgain(input.task, "--accept <test file>")} or --accept-cmd "<command>"`;
  const notes = required
    .filter((one) => one.id !== "R1" && !independent(one.id))
    .map(
      (one) =>
        `${described(one)} has no independent check (${why(one.id)}), so it stays unverified unless a failing base test the change fixes is mapped to it; supply one that fails today with --accept ${one.id}=<test file>.`,
    );
  return { ...gate, blocked, notes };
}

const described = (one: Requirement) =>
  one.id === "R1" ? "R1 (the task)" : `${one.id} (${JSON.stringify(one.text)})`;

async function sealed(
  input: { readonly workspace: string; readonly home: string },
  user: readonly UserCheck[],
  unreviewed: readonly Test[],
  authored: readonly Authored[],
): Promise<readonly TrustedCheck[]> {
  if (user.some((one) => one.path !== null))
    return sealUserChecks(input.workspace, input.home, user);
  if (unreviewed.length > 0) await sealAuthored(input.workspace, authored, input.home);
  return sealUserChecks(
    input.workspace,
    input.home,
    user.filter((one) => one.path === null),
  );
}

const commonParts = new Set(
  "test tests spec specs src lib unit integration e2e index main util utils helpers fixtures core packages js mjs cjs ts mts tsx jsx py".split(
    " ",
  ),
);

/**
 * Whether a test file's path shares a word with the task: a failing base test the task bears on.
 * A README test-count claim failing at tracemantle's base shares none with a template fix.
 */
function bearsOn(task: string): (path: string) => boolean {
  const words = new Set(
    task
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z][a-z0-9]{3,}/g) ?? [],
  );
  return (path) =>
    path
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((part) => part.length >= 4 && !commonParts.has(part) && words.has(part));
}
