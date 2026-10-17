import type { BehaviorCheck } from "./evidence/behavior-check.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { differingLines } from "./gates/behavior-check.ts";
import { assembleGates, type GateSetOptions } from "./gates/default-gates.ts";
import { createGitWorkspaceProbe } from "./gates/git-workspace.ts";
import { detectProject } from "./gates/project-type.ts";

/**
 * Admission of planned checks by their base control, before any implementation exists.
 *
 * A planned check is the model's reading of the task, so it is held to the one control that
 * needs no reference implementation: the unchanged base. A check that says it detects the
 * requested change must get the base wrong, by a completed run whose checked output differs,
 * never by failing to start; a check that says it preserves behaviour must pass there. What
 * does not hold is dropped, with the reason on the planning chain, and a planned requirement
 * left without a check goes with it: an interpretation nothing executable supports does not
 * become a requirement. One base and one wrong implementation is evidence, not proof that a
 * check means what the task means; a check can still be wrong in a way the base cannot show.
 */
export interface PlannedCheckDecision {
  readonly check: string;
  readonly atBase: "fails" | "passes" | null;
  readonly observed: "accepted" | "rejected" | "unjudged" | "not-run";
  readonly admitted: boolean;
  readonly reason: string;
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
  readonly droppedRequirements: readonly string[];
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
    if (suppliedRequirements.has(requirement.id)) return [requirement];
    const checks = requirement.checks.filter((id) => kept.has(id));
    return checks.length === 0 ? [] : [{ ...requirement, checks }];
  });
  const droppedRequirements = input.contract.requirements
    .filter((requirement) => !requirements.some((one) => one.id === requirement.id))
    .map((requirement) => requirement.id);
  const contract =
    requirements.length === 0
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
      admittedContract: contract === null ? null : freezeGoalContract(contract).digest,
    }),
  });
  return { contract, decisions, droppedRequirements };
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
 * Every case threw on the base, where the check expects none to: a program that cannot call
 * the project the way it means to, which reads as broken rather than as the missing change.
 */
function threwEverywhere(check: GoalContract["checks"][number], seen: ObservedCheck): boolean {
  const expected = expectedStdout(check);
  if (expected === null || expected.includes('"threw":true')) return false;
  const lines = seen.stdout.split("\n").filter((line) => line.length > 0);
  return lines.length > 0 && lines.every((line) => line.endsWith('"threw":true}'));
}

function decide(
  check: GoalContract["checks"][number],
  seen: ObservedCheck | undefined,
): PlannedCheckDecision {
  const decision =
    seen !== undefined && check.atBase === "fails" && seen.completed && threwEverywhere(check, seen)
      ? {
          check: check.id,
          atBase: check.atBase,
          record: seen.record,
          observed: seen.status,
          admitted: false,
          reason:
            "every case threw on the base, which shows a program that cannot call the project rather than the missing change",
        }
      : judgeAtBase(check, seen);
  const broken =
    !decision.admitted &&
    seen !== undefined &&
    (seen.status === "unjudged" || !seen.completed || threwEverywhere(check, seen));
  const expected = expectedStdout(check);
  const excerpt = decision.admitted
    ? null
    : broken
      ? (seen?.output ?? null)
      : check.atBase === "passes" && seen !== undefined && expected !== null
        ? differingLines(expected, seen.stdout).join("; ")
        : null;
  return { ...decision, broken, excerpt };
}
function judgeAtBase(
  check: GoalContract["checks"][number],
  seen: ObservedCheck | undefined,
): Omit<PlannedCheckDecision, "broken" | "excerpt"> {
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
