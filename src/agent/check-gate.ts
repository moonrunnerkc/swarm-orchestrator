import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TrustedCheck } from "swarm-verify";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { type Authored, authorChecks, sealAuthored } from "./check-author.ts";
import type { ModelClient } from "./model.ts";
import { type RequirementRecord, withAuthored } from "./requirement-record.ts";
import { claimsIn, type Supplied } from "./supplied.ts";
import { testConventions } from "./test-conventions.ts";
import { createTurnChecks, type TurnChecks } from "./turn-checks.ts";
import { sealUserChecks, type UserCheck, validateSupplied } from "./user-checks.ts";

/**
 * What happens to the checks the author writes: used as written (`--accept-authored`), shown to
 * the user to approve, edit or reject (`--review-checks`), or written out for the user to edit and
 * supply with `--accept` (`--write-checks`), where the run stops before its first edit.
 */
export type ChecksMode =
  | { readonly kind: "accept-authored" }
  | { readonly kind: "review"; readonly reviewer: CheckReviewer }
  | { readonly kind: "write"; readonly directory: string };

/** One authored check shown to the user, written to `file` for them to edit in place. */
export interface ShownCheck {
  readonly requirement: string;
  readonly path: string;
  readonly file: string;
  readonly content: string;
  /** Why the last edit was refused, where it was. */
  readonly problem: string | null;
}
export type CheckReviewer = (shown: ShownCheck) => Promise<"approve" | "edit" | "reject">;

export interface CheckGate {
  readonly record: RequirementRecord;
  readonly authored: readonly Authored[];
  readonly user: readonly UserCheck[];
  readonly trusted: readonly TrustedCheck[];
  readonly checks: TurnChecks;
  /** Why the run stops before its first edit; null where it goes on. */
  readonly blocked: string | null;
}

const runAgain = (task: string, what: string) => `swarm run ${JSON.stringify(task)} ${what}`;

/**
 * Between recording the requirements and the first edit: the user's checks validated at the base,
 * the author's checks for R1 where the user supplied none (written by a fresh-context call that
 * never sees the change), reviewed or written out as the mode says, and sealed outside the tree.
 * Where R1 is left with no independent check and no failing base test a change could make pass,
 * the run stops here: nothing it could do would be shown met.
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
  readonly signal?: AbortSignal | undefined;
}): Promise<CheckGate> {
  const conventions = await testConventions(input.workspace, input.task);
  const validated = await validateSupplied({ ...input, conventions });
  const user: UserCheck[] = [...validated.checks];
  let claims = [...validated.claims];
  const r1 = input.record.requirements.find((one) => one.id === "R1");
  const covered = claims.length > 0 || user.some((one) => one.requirement === "R1");
  const authored =
    r1 === undefined || covered
      ? []
      : [await authorChecks({ ...input, requirement: r1, conventions })];
  const first = authored[0];
  let unreviewed = first?.test === null || first === undefined ? [] : [first.test];
  let structure = first?.structure ?? [];
  let blocked: string | null =
    validated.refused.length > 0
      ? `your checks were refused: ${validated.refused.join("; ")}`
      : null;

  const produced = unreviewed.length > 0 || structure.length > 0;
  if (blocked === null && produced && input.mode.kind === "write") {
    const written = await writeOut(input.mode.directory, unreviewed, structure);
    blocked = `the check author's checks for R1 were written to ${input.mode.directory} (${written.join(", ")}) for you to read and edit; then run ${runAgain(input.task, `--accept ${input.mode.directory}`)}`;
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
  const names = trusted
    .filter((one) => user.some((u) => u.name === one.name && u.requirement === "R1"))
    .map((one) => one.name);
  const kind = first?.kind ?? null;
  const record =
    kind === null && claims.length === 0 && names.length === 0
      ? input.record
      : withAuthored(
          input.record,
          kind ?? r1?.kind ?? "other",
          [...claims, ...structure],
          first?.behaviorAsked ?? false,
          names,
        );
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
  if (blocked !== null) return { record, authored, user, trusted, checks, blocked };
  // Still the base: what the declared tests do before any edit, for regressions to be read from.
  await checks.baseline();
  return { record, authored, user, trusted, checks, blocked };
}

async function sealed(
  input: { readonly workspace: string; readonly home: string },
  user: readonly UserCheck[],
  unreviewed: readonly NonNullable<Authored["test"]>[],
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

async function writeOut(
  directory: string,
  tests: readonly NonNullable<Authored["test"]>[],
  structure: Authored["structure"],
): Promise<string[]> {
  const written: string[] = [];
  for (const test of tests) {
    const target = join(directory, test.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, test.content);
    written.push(test.path);
  }
  if (structure.length > 0) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "R1.claims.json"), `${JSON.stringify(structure, null, 2)}\n`);
    written.push("R1.claims.json");
  }
  return written;
}

/**
 * Each authored check shown to the user in turn. An approved or edited one becomes the user's
 * own (`user-acceptance`): a person stands behind it now. An edit is run at the base again, as
 * any supplied check is, and shown again with the reason where it is refused.
 */
async function review(
  input: Parameters<typeof checkGate>[0],
  reviewer: CheckReviewer,
  tests: readonly NonNullable<Authored["test"]>[],
  structure: Authored["structure"],
  conventions: Awaited<ReturnType<typeof testConventions>>,
): Promise<{ readonly user: UserCheck[]; readonly claims: Authored["structure"] }> {
  const shown = [
    ...tests.map((test) => ({ path: test.path, content: test.content })),
    ...(structure.length === 0
      ? []
      : [{ path: "R1.claims.json", content: `${JSON.stringify(structure, null, 2)}\n` }]),
  ];
  const user: UserCheck[] = [];
  let claims: Authored["structure"] = [];
  for (const one of shown) {
    const file = join(input.scratch, "review", one.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, one.content);
    let problem: string | null = null;
    while (true) {
      const content = await readFile(file, "utf8");
      const answer = await reviewer({ requirement: "R1", path: one.path, file, content, problem });
      if (answer === "reject") break;
      const edited = await readFile(file, "utf8");
      if (one.path === "R1.claims.json") {
        const parsed = claimsOf(edited, one.path);
        if (typeof parsed === "string") {
          problem = parsed;
          continue;
        }
        const read = {
          kind: "claims" as const,
          requirement: "R1",
          source: one.path,
          claims: parsed,
        };
        const checked = await validateSupplied({ ...input, conventions, supplied: [read] });
        problem = checked.refused[0] ?? null;
        if (problem === null) {
          claims = checked.claims;
          break;
        }
        continue;
      }
      const supplied: Supplied = {
        kind: "file",
        requirement: "R1",
        path: one.path,
        content: edited,
      };
      const checked = await validateSupplied({ ...input, conventions, supplied: [supplied] });
      problem = checked.refused[0] ?? null;
      if (problem === null) {
        user.push(
          ...checked.checks.map((check) => ({ ...check, name: `reviewed-R1-${user.length + 1}` })),
        );
        break;
      }
    }
  }
  return { user, claims };
}

/** The claims an edited file holds, as the user's, or why it holds none. */
function claimsOf(text: string, source: string): Authored["structure"] | string {
  try {
    return claimsIn(text, source) ?? "it is not JSON";
  } catch (error) {
    return (error as Error).message;
  }
}
