import type { BehaviorCheck } from "./evidence/behavior-check.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { differingLines } from "./gates/behavior-check.ts";
import { assembleGates, type GateSetOptions } from "./gates/default-gates.ts";
import { createGitWorkspaceProbe } from "./gates/git-workspace.ts";
import { detectProject } from "./gates/project-type.ts";
import {
  plannedRelation,
  programDidNotLoad,
  programMisreadInput,
  relationAgreedSomewhere,
} from "./workers/planned-check-program.ts";

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
   * What the base run showed about the check, each kind with its own remedy: the program did not
   * load (an import), it read a case's own fields off the input it was given (the argument's
   * shape), it did not finish, it reached no behaviour of the project anyone can tell from a
   * constant (an empty fixture, a wrong call, an ignored input; an uncertainty, not a failure of
   * the project), its expectation contradicts what the base does where the task keeps behaviour,
   * or, for a change check, the base already passes it.
   */
  readonly finding:
    | "admitted"
    | "not-run"
    | "unjudged"
    | "did-not-load"
    | "argument-shape"
    | "did-not-complete"
    | "no-control"
    | "expectation-contradicted"
    | "does-not-detect";
  /**
   * What shows the program observes the project through the very adapter and input convention
   * the other cases use, or null where nothing does. For cases: the base gave the expected
   * result for these (1-based) cases, and the base's answers are not all one value, which is what
   * a program that ignores its input or calls an empty object gives everywhere. For a relation:
   * some variant behaved like the reference somewhere on the base. Its source is the base's own
   * output agreeing with the planner; it shows the program reaches the project's behaviour, not
   * that every expectation is right.
   */
  readonly control: {
    readonly source: "base-agreement" | "relation-agreement";
    readonly cases: readonly number[];
  } | null;
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
  readonly exitCode: number | null;
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
      exitCode: payload.observation?.exitCode ?? null,
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

/** What the base answered for each case, without the input it echoes: the program's answers. */
function answers(stdout: string): readonly string[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        const { input: _input, ...answer } = JSON.parse(line) as Record<string, unknown>;
        return JSON.stringify(answer);
      } catch {
        return line;
      }
    });
}

/**
 * The control a check of cases has on the base: the cases whose expected line the base printed,
 * provided the base's answers are not all one value. Agreement alone is not a control. A live
 * planner's programs passed undefined to the project, which answered null for every case, and
 * their null-expecting cases agreed; an empty fixture, a call to the wrong method and an ignored
 * input give one answer everywhere in the same way. Where the answers differ, the program's
 * answer depends on its input, and the agreeing cases show the planner's expectation and the
 * project's behaviour meeting through the same adapter as the other cases. Null where there is
 * no such case, which is an inability to establish a control, not a failure of the project.
 */
function casesControl(
  check: GoalContract["checks"][number],
  seen: ObservedCheck,
): PlannedCheckDecision["control"] {
  const expected = expectedStdout(check);
  if (expected === null) return null;
  const want = expected.split("\n").filter((line) => line.length > 0);
  const got = seen.stdout.split("\n");
  const agreeing = want.flatMap((line, index) => (got[index] === line ? [index + 1] : []));
  const distinct = new Set(answers(seen.stdout)).size;
  return agreeing.length > 0 && distinct > 1 ? { source: "base-agreement", cases: agreeing } : null;
}

const remedies = {
  "argument-shape":
    "its program read a field of the value it was called with as though it were the case, but the program is called with each case's input itself (the string, number or object written as input), never with { input, expected }: take the input as the parameter",
  "did-not-complete":
    "it fails on the base without completing, which shows a broken check rather than the missing change",
  "no-control-change":
    "nothing shows its program reaches the project: on the base every case gave one and the same answer, which is what a program that ignores its input, calls an empty or wrongly built object, or calls the wrong function gives for everything, so a case agreeing with that answer proves nothing. Check that the program passes its input to the project and builds what it calls as the repository's own tests do, and include a case the task does not change whose answer the base gives and differs from the changed cases' (a known-working input from the task or the repository's tests)",
  "no-agreeing-case":
    "it gets every case wrong on the base, so nothing shows its program calls the project correctly; a change check also holds a case the task does not change, which the base gets right",
  "no-control-preserve":
    "on the base every case gave one and the same answer, which a program that ignores its input or calls an empty or wrongly built object gives for everything, so this reads as a check that does not reach the project rather than as behaviour the task keeps: check that the program passes its input to the project and builds what it calls as the repository's own tests do",
  "no-control-relation":
    "no variant behaved like the reference at any position of any seed on the base, so nothing shows its program observes the project correctly; give it a seed, or a position, the base already treats alike",
} as const;

function decide(
  check: GoalContract["checks"][number],
  seen: ObservedCheck | undefined,
): PlannedCheckDecision {
  const atBase = check.atBase ?? null;
  const relation = plannedRelation(check);
  const expected = expectedStdout(check);
  const basis =
    check.atBase === "passes" ? ("base-observed" as const) : ("model-asserted" as const);
  const verdict = (
    finding: PlannedCheckDecision["finding"],
    reason: string,
    control: PlannedCheckDecision["control"] = null,
  ): PlannedCheckDecision => {
    const admitted = finding === "admitted";
    const broken =
      finding === "unjudged" ||
      finding === "did-not-load" ||
      finding === "argument-shape" ||
      finding === "did-not-complete" ||
      finding === "no-control";
    return {
      check: check.id,
      atBase,
      observed: seen?.status ?? "not-run",
      admitted,
      reason,
      basis,
      claimedChanges: claimedChanges(check, seen),
      broken,
      finding,
      control,
      excerpt: admitted
        ? null
        : broken
          ? (seen?.output ?? null)
          : finding === "expectation-contradicted" && seen !== undefined && expected !== null
            ? differingLines(expected, seen.stdout).join("; ")
            : null,
      record: seen?.record ?? null,
    };
  };
  if (seen === undefined) return verdict("not-run", "the base run recorded no result for it");
  if (seen.status === "unjudged")
    return verdict(
      "unjudged",
      `it could not be judged on the base${seen.unavailable === null ? "" : `: ${seen.unavailable}`}`,
    );
  if (seen.exitCode === programMisreadInput)
    return verdict("argument-shape", remedies["argument-shape"]);
  if (!seen.completed)
    return verdict(
      seen.exitCode === programDidNotLoad ? "did-not-load" : "did-not-complete",
      atBase === "passes"
        ? "it does not run to completion on the base"
        : remedies["did-not-complete"],
    );
  const control =
    relation === null
      ? casesControl(check, seen)
      : relationAgreedSomewhere(relation, seen.stdout)
        ? { source: "relation-agreement" as const, cases: [] }
        : null;
  if (atBase === "passes") {
    if (seen.status === "accepted")
      return verdict(
        "admitted",
        "it passes on the base, which keeps the behaviour it checks",
        control,
      );
    // Two or more cases with one answer between them read as a program that never reached the
    // project; one case cannot tell, and stands as a contradicted expectation.
    return relation === null &&
      answers(seen.stdout).length > 1 &&
      new Set(answers(seen.stdout)).size === 1
      ? verdict("no-control", remedies["no-control-preserve"])
      : verdict(
          "expectation-contradicted",
          "it fails on the base, so its expectation contradicts behaviour the task keeps",
        );
  }
  if (atBase === "fails") {
    if (seen.status === "accepted")
      return verdict(
        "does-not-detect",
        "it passes on the base, so it does not detect the requested change",
      );
    return control === null
      ? verdict(
          "no-control",
          relation !== null
            ? remedies["no-control-relation"]
            : (claimedChanges(check, seen)?.cases ?? 0) === (claimedChanges(check, seen)?.of ?? 0)
              ? remedies["no-agreeing-case"]
              : remedies["no-control-change"],
        )
      : verdict(
          "admitted",
          "it completes on the base with a wrong result, as a check of the change must",
          control,
        );
  }
  return verdict("unjudged", "it declares no base expectation");
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
