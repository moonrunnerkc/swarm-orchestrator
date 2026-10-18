import type { BehaviorCheck } from "./evidence/behavior-check.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { differingLines } from "./gates/behavior-check.ts";
import { assembleGates, type GateSetOptions } from "./gates/default-gates.ts";
import { createGitWorkspaceProbe } from "./gates/git-workspace.ts";
import { detectProject } from "./gates/project-type.ts";
import { plannedRelation, relationAgreedSomewhere } from "./workers/planned-check-program.ts";

/**
 * Admission of planned checks by their base control, before any implementation exists.
 *
 * A planned check is the model's reading of the task, so it is held to the one control that
 * needs no reference implementation: the unchanged base. A check that says it detects the
 * requested change must get the base wrong, by a completed run whose checked output differs,
 * never by failing to start; a check that says it preserves behaviour must pass there. What
 * does not hold is dropped, with the reason on the planning chain.
 *
 * Admission answers whether a check runs and whether it tells the base from the change. It does
 * not answer whether its expectations are right: a preserve check's results are what the base
 * printed, and a change check's results for the cases the base gets wrong are the planner's
 * claim. So an admitted check is a diagnostic, never the grounds for a verdict (see `planned` in
 * the goal contract). A planned requirement that quotes the task stays sealed when its checks are
 * dropped, unjudged, since the user's words did not stop being a requirement; one the planner
 * invented, with no quote and no admitted check, is dropped and reported as unsupported.
 */
export interface PlannedCheckDecision {
  readonly check: string;
  readonly atBase: "fails" | "passes" | null;
  readonly observed: "accepted" | "rejected" | "unjudged" | "not-run";
  readonly admitted: boolean;
  readonly reason: string;
  /**
   * What its expected results rest on: the base's own output (a preserve check), or the
   * planner's claim of what the change produces (a change check). Neither is independent
   * evidence that the expectation is what the task means.
   */
  readonly basis: "base-observed" | "model-asserted";
  /**
   * Of a completed base run, how many of its cases expect something other than what the base
   * printed: the cases whose expectation only the planner vouches for. Null where the base run
   * did not complete or the check has no case-by-case output.
   */
  readonly claimedChanges: { readonly cases: number; readonly of: number } | null;
  /**
   * Dropped because it never produced a result to judge (it did not run to completion, could
   * not be judged, or threw on every case), as against a result that contradicts its claim.
   */
  readonly broken: boolean;
  /**
   * What the planner is shown to revise a dropped check: for a broken one, the start of what it
   * printed on the base; for a preserve check the base got wrong, the cases it got wrong with
   * what the base gave. Null for an admitted check, and for a change check the base already
   * satisfies, whose base results are its own expectations and would only invite fitting them.
   */
  readonly excerpt: string | null;
  readonly record: string | null;
}

export interface PlannedCheckAdmission {
  /** The supplied contract plus every admitted addition; null where nothing usable remains. */
  readonly contract: GoalContract | null;
  readonly decisions: readonly PlannedCheckDecision[];
  /** Planned requirements dropped: invented, with no quote of the task and no admitted check. */
  readonly droppedRequirements: readonly string[];
  /** Planned requirements in the task's words that kept no admitted check, sealed unjudged. */
  readonly unverifiedRequirements: readonly string[];
}

interface ObservedCheck {
  readonly status: "accepted" | "rejected" | "unjudged";
  readonly completed: boolean;
  readonly unavailable: string | null;
  readonly stdout: string;
  readonly output: string;
  readonly record: string;
}

export async function admitPlannedChecks(input: {
  readonly contract: GoalContract;
  readonly base: GoalContract | undefined;
  /** The planning chain, which the base run writes its check records to. */
  readonly evidence: EvidenceRecorder;
  /** Runs a contract's checks on a fresh checkout of the unchanged base. */
  readonly verifyAtBase: (contract: GoalContract) => Promise<unknown>;
}): Promise<PlannedCheckAdmission> {
  const supplied = new Set((input.base?.checks ?? []).map((check) => check.id));
  const planned = input.contract.checks.filter((check) => !supplied.has(check.id));
  const mark = input.evidence.records().length;
  if (planned.length > 0)
    await input.verifyAtBase(
      freezeGoalContract({
        version: 1,
        goal: input.contract.goal,
        requirements: [
          {
            id: "planned-at-base",
            description: "each planned check on the unchanged base",
            checks: planned.map((check) => check.id),
          },
        ],
        checks: planned,
        immutablePaths: input.contract.immutablePaths,
      }).contract,
    );
  const observed = observedChecks(input.evidence, mark);
  const decisions = planned.map((check) => decide(check, observed.get(check.id)));
  const admitted = new Set(decisions.filter((one) => one.admitted).map((one) => one.check));
  const kept = new Set([...supplied, ...admitted]);
  const suppliedRequirements = new Set((input.base?.requirements ?? []).map((one) => one.id));
  const requirements = input.contract.requirements.flatMap((requirement) => {
    if (suppliedRequirements.has(requirement.id) || requirement.planned === undefined)
      return [requirement];
    const diagnostics = requirement.planned.diagnostics.filter((id) => kept.has(id));
    if (diagnostics.length === 0 && requirement.planned.quote === undefined) return [];
    return [{ ...requirement, planned: { ...requirement.planned, diagnostics } }];
  });
  const droppedRequirements = input.contract.requirements
    .filter((requirement) => !requirements.some((one) => one.id === requirement.id))
    .map((requirement) => requirement.id);
  const unverifiedRequirements = requirements
    .filter((one) => one.planned !== undefined && one.planned.diagnostics.length === 0)
    .map((one) => one.id);
  // Without a supplied contract and with nothing admitted there is nothing executable to implement
  // against, which ends planning as it did; the quoted requirements are still named.
  const contract =
    requirements.length === 0 || (input.base === undefined && admitted.size === 0)
      ? null
      : freezeGoalContract({
          ...input.contract,
          requirements,
          checks: input.contract.checks.filter((check) => kept.has(check.id)),
        }).contract;
  await input.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      rule: "planned-check-admission-v1",
      decisions,
      droppedRequirements,
      unverifiedRequirements,
      admittedContract: contract === null ? null : freezeGoalContract(contract).digest,
    }),
  });
  return { contract, decisions, droppedRequirements, unverifiedRequirements };
}

/** The completed goal-check records the base run wrote after `mark`, by check id. */
function observedChecks(
  evidence: EvidenceRecorder,
  mark: number,
): ReadonlyMap<string, ObservedCheck> {
  const found = new Map<string, ObservedCheck>();
  for (const record of evidence.records().slice(mark)) {
    if (record.type !== "goal-check") continue;
    const payload = evidence.payloads().get(record.payloadDigest) as
      | {
          phase?: string;
          checkId?: string;
          status?: "accepted" | "rejected" | "unjudged";
          behavior?: { exitCode?: number };
          observation?: {
            exitCode?: number;
            unavailable?: string | null;
            outputTruncated?: boolean;
            stdout?: string;
            stderr?: string;
          };
        }
      | undefined;
    if (
      payload?.phase !== "completed" ||
      payload.checkId === undefined ||
      payload.status === undefined
    )
      continue;
    found.set(payload.checkId, {
      status: payload.status,
      // A completed run: it exited as the check expects a finished script to, and its output was
      // read whole. A script that could not import the project is not a run that got it wrong.
      completed:
        payload.observation?.unavailable === null &&
        payload.observation.outputTruncated !== true &&
        payload.observation.exitCode === payload.behavior?.exitCode,
      unavailable: payload.observation?.unavailable ?? null,
      stdout: payload.observation?.stdout ?? "",
      output: `exit ${payload.observation?.exitCode ?? "unknown"}; stderr: ${(payload.observation?.stderr ?? "").slice(0, excerptChars)}; stdout: ${(payload.observation?.stdout ?? "").slice(0, excerptChars)}`,
      record: record.payloadDigest,
    });
  }
  return found;
}

const excerptChars = 1200;

/** The one stdout equality a planned check is judged by, where it has one. */
function expectedStdout(check: GoalContract["checks"][number]): string | null {
  const behavior: BehaviorCheck | undefined = check.behavior;
  if (behavior?.kind !== "cli") return null;
  const [only] = behavior.stdout;
  return behavior.stdout.length === 1 && only?.kind === "equals" ? only.value : null;
}

/**
 * Every case of a change check came out wrong on the base. A check of the change is admitted by
 * the base getting the change wrong, and a program that cannot call the project at all (it
 * constructs the project's object wrongly, imports the wrong thing, or throws) gets every case
 * wrong as well, so the two read alike. A live planner's checks built their own instance of the
 * class wrongly, answered null for everything, were admitted, and refused every compliant
 * implementation. A change check therefore also holds a case the task does not change, which the
 * base must get right: its control that the program observes the project correctly.
 */
function wrongEverywhere(check: GoalContract["checks"][number], seen: ObservedCheck): boolean {
  const relation = plannedRelation(check);
  if (relation !== null) return !relationAgreedSomewhere(relation, seen.stdout);
  const expected = expectedStdout(check);
  if (expected === null) return false;
  const want = expected.split("\n").filter((line) => line.length > 0);
  const got = seen.stdout.split("\n");
  return want.length > 0 && want.every((line, index) => got[index] !== line);
}

function decide(
  check: GoalContract["checks"][number],
  seen: ObservedCheck | undefined,
): PlannedCheckDecision {
  const uncontrolled =
    seen !== undefined &&
    check.atBase === "fails" &&
    seen.completed &&
    wrongEverywhere(check, seen);
  const decision = uncontrolled
    ? {
        check: check.id,
        atBase: "fails" as const,
        record: seen.record,
        observed: seen.status,
        admitted: false,
        reason:
          plannedRelation(check) === null
            ? "it gets every case wrong on the base, so nothing shows its program calls the project correctly; a change check also holds a case the task does not change, which the base gets right"
            : "no variant behaved like the reference at any position of any seed on the base, so nothing shows its program observes the project correctly; give it a seed, or a position, the base already treats alike",
      }
    : judgeAtBase(check, seen);
  const broken =
    !decision.admitted &&
    seen !== undefined &&
    (seen.status === "unjudged" || !seen.completed || uncontrolled);
  const expected = expectedStdout(check);
  const excerpt = decision.admitted
    ? null
    : broken
      ? (seen?.output ?? null)
      : check.atBase === "passes" && seen !== undefined && expected !== null
        ? differingLines(expected, seen.stdout).join("; ")
        : null;
  return {
    ...decision,
    broken,
    excerpt,
    basis: check.atBase === "passes" ? "base-observed" : "model-asserted",
    claimedChanges: claimedChanges(check, seen),
  };
}

function claimedChanges(
  check: GoalContract["checks"][number],
  seen: ObservedCheck | undefined,
): PlannedCheckDecision["claimedChanges"] {
  const expected = expectedStdout(check);
  if (expected === null || seen === undefined || !seen.completed) return null;
  const want = expected.split("\n").filter((line) => line.length > 0);
  const got = seen.stdout.split("\n");
  return { cases: want.filter((line, index) => got[index] !== line).length, of: want.length };
}

function judgeAtBase(
  check: GoalContract["checks"][number],
  seen: ObservedCheck | undefined,
): Omit<PlannedCheckDecision, "broken" | "excerpt" | "basis" | "claimedChanges"> {
  const atBase = check.atBase ?? null;
  const base = { check: check.id, atBase, record: seen?.record ?? null };
  if (seen === undefined)
    return {
      ...base,
      observed: "not-run",
      admitted: false,
      reason: "the base run recorded no result for it",
    };
  const observed = seen.status;
  if (observed === "unjudged")
    return {
      ...base,
      observed,
      admitted: false,
      reason: `it could not be judged on the base${seen.unavailable === null ? "" : `: ${seen.unavailable}`}`,
    };
  if (atBase === "passes")
    return observed === "accepted"
      ? {
          ...base,
          observed,
          admitted: true,
          reason: "it passes on the base, which keeps the behaviour it checks",
        }
      : {
          ...base,
          observed,
          admitted: false,
          reason: seen.completed
            ? "it fails on the base, so its expectation contradicts behaviour the task keeps"
            : "it does not run to completion on the base",
        };
  if (atBase === "fails") {
    if (observed === "accepted")
      return {
        ...base,
        observed,
        admitted: false,
        reason: "it passes on the base, so it does not detect the requested change",
      };
    return seen.completed
      ? {
          ...base,
          observed,
          admitted: true,
          reason: "it completes on the base with a wrong result, as a check of the change must",
        }
      : {
          ...base,
          observed,
          admitted: false,
          reason:
            "it fails on the base without completing, which shows a broken check rather than the missing change",
        };
  }
  return { ...base, observed, admitted: false, reason: "it declares no base expectation" };
}

/**
 * What the harness does to a fresh checkout of the base before a planned check runs there, in a
 * sentence the planner is given: the install and the repository checks the run is configured
 * with, read from the base as the verifier reads them. The planner then knows whether the build
 * output its program imports will exist, rather than arranging a build inside the check, which
 * is what broke the checks of earlier launches.
 */
export async function describeCheckoutPreparation(input: {
  readonly workspace: string;
  readonly baseCommit: string;
  readonly install: boolean;
  readonly lockfile?: string;
  readonly gateOptions: GateSetOptions;
}): Promise<string> {
  const probe = createGitWorkspaceProbe({
    workspaceRoot: input.workspace,
    baseRef: input.baseCommit,
  });
  const gates = assembleGates(
    await detectProject((path) => probe.readBase(path)),
    input.gateOptions,
  ).flatMap((gate) =>
    gate.source.kind === "command" ? [`${gate.id} (${gate.source.command})`] : [],
  );
  return [
    "Before your checks run, the harness makes a fresh checkout of the unchanged base,",
    input.install
      ? `installs its dependencies${input.lockfile === undefined ? "" : ` from ${input.lockfile}`},`
      : "installs nothing (the run was not given --install),",
    gates.length === 0
      ? "and runs no repository command first."
      : `then runs the repository's checks, ${gates.join(", ")}, so whatever those commands build is in place when your program runs.`,
    "The same preparation runs before every candidate is checked.",
  ].join(" ");
}
