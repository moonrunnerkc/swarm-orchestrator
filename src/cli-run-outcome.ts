import type { GoalContract } from "./evidence/goal-contract.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { blockingReason, type RunVerdict } from "./evidence/verdict.ts";
import type { AutoResolveOutcome } from "./gates/auto-resolve.ts";
import type { GateCycle } from "./gates/gate-runner.ts";
import { exitCodes } from "./machine-output.ts";
import type {
  FinalVerificationOutcome,
  InterventionCounts,
  OutcomeStatus,
  RequirementOutcome,
  RunOutcomeReport,
  SetupUsage,
  UnresolvedOutcomeReport,
} from "./run-outcome-shape.ts";
import { formatElapsed } from "./tui/elapsed.ts";
import { formatCost, formatTokens } from "./tui/evidence-panel.ts";

/**
 * What a person needs to read first when a run ends, derived from harness observations only:
 * what was asked, which requirements were measured and how each came out, what changed and
 * where, which checks ran over that tree and what they could not measure, what the run cost,
 * which interventions happened, and the one next action when the run is not acceptable. The
 * evidence panel that follows it is where the deeper record is; this is the summary a reader
 * should not have to assemble from it.
 */
export type { OutcomeStatus, RequirementOutcome } from "./run-outcome-shape.ts";

/** The gate the sealed goal contract's supplied checks are judged through. */
export const acceptanceGateId = "task-acceptance";
/** The gate a contract's generated checks run through, where it has any. */
export const diagnosticsGateId = "task-diagnostics";
/** Their results are read off the requirements and the final verification, never as a gate failure. */
const contractGates = new Set([acceptanceGateId, diagnosticsGateId]);

export interface RunOutcomeInput {
  readonly task: string;
  /**
   * Accepted repair attempts that only generated checks asked for: nothing that decides was
   * failing when they began. Their change rests on expectations nothing independent establishes.
   */
  readonly repairsForGeneratedChecksOnly?: readonly number[];
  readonly verdict: RunVerdict;
  readonly lifecycle: string;
  readonly workspace: string;
  readonly branch: string | null;
  readonly baseCommit: string;
  readonly changedFiles: readonly string[];
  readonly diffTruncated: boolean;
  readonly gates: GateCycle;
  readonly requirements: readonly RequirementOutcome[] | null;
  readonly uncheckedRequirements?: RunOutcomeReport["uncheckedRequirements"];
  /**
   * Planned requirements planning left with no retained check, with why and the next useful action,
   * as planning reconciled them. Shown beside the requirement rather than dropped from the report.
   */
  readonly uncovered?: readonly {
    readonly id: string;
    readonly reason: string;
    readonly nextAction: string;
  }[];
  /** Requested outcomes no retained check states, as planning reconciled them per outcome. */
  readonly unresolvedOutcomes?: readonly UnresolvedOutcomeReport[];
  /** Null where no final independent verification ran. */
  readonly finalVerification: FinalVerificationOutcome | null;
  readonly usage: {
    readonly durationMs: number;
    readonly steps: number;
    readonly tokensUsed: number;
    readonly callsWithUnknownUsage: number;
    readonly costUsd: number | null;
    readonly setup: SetupUsage | null;
  };
  readonly interventions: InterventionCounts;
  readonly runId: string;
  readonly resumable: boolean;
}

/**
 * The run's one reading, from harness records only. Requirements are of two kinds: those supplied
 * in a goal contract, which are the authorized acceptance criteria and are decided by their checks,
 * and those the planner read from the task, which are hypotheses whose generated checks inform and
 * drive repair and decide nothing in either direction.
 *
 * | the run                                                        | status              | exit |
 * | -------------------------------------------------------------- | ------------------- | ---- |
 * | acceptable, no supplied requirement (none sealed, or only      | `unjudged`          | 0    |
 * |   planned ones whose generated checks did not disagree)        |                     |      |
 * | acceptable, every supplied requirement met                     | `accepted`          | 0    |
 * | a supplied check, a blocking gate, policy, the final           | `not-accepted`      | 1    |
 * |   verification or the fresh checkout's suite refused it        |                     |      |
 * | the model or the verification environment was unavailable     | `unverified`        | 4    |
 * | a generated check disagrees and nothing above refused          | `unresolved`        | 1    |
 * | a supplied requirement no check that ran decided               | `partially-checked` | 1    |
 *
 * A planned requirement with no generated check, and one the planner invented with no quote of
 * the task, change no status: they are named, as a task sentence nobody tracked is not. Their
 * uncertainty is the same an ordinary run carries unspoken, and naming it must not make the
 * outcome worse than not looking. A generated check's disagreement is an observation a person
 * has to settle, so it is never read as acceptance and never as a refusal.
 */
export function outcomeStatus(
  input: Pick<
    RunOutcomeInput,
    "verdict" | "lifecycle" | "gates" | "requirements" | "finalVerification" | "changedFiles"
  >,
): OutcomeStatus {
  const supplied = (input.requirements ?? []).filter((one) => one.source !== "planned");
  if (input.verdict.acceptable)
    return supplied.length === 0
      ? "unjudged"
      : supplied.every((one) => one.status === "accepted")
        ? "accepted"
        : "partially-checked";
  const refusedByWhatDecides =
    input.lifecycle === "interrupted" ||
    supplied.some((one) => one.status === "rejected") ||
    input.gates.blockingFailures.some((run) => !contractGates.has(run.gateId)) ||
    input.verdict.policy === "fail" ||
    // Nothing executed a change no dynamic gate ran over. A failed acceptance gate did execute
    // it, whether a supplied check or a generated one refused.
    (input.changedFiles.length > 0 &&
      !input.gates.runs.some(
        (run) => run.capability === "dynamic" && run.status !== "not-applicable",
      )) ||
    input.finalVerification?.refusal != null ||
    input.finalVerification?.regression === "fail";
  if (refusedByWhatDecides) return "not-accepted";
  if (input.lifecycle === "model-error" || input.finalVerification?.unmeasured === true)
    return "unverified";
  if (
    (input.requirements ?? []).some((one) =>
      one.generatedChecks?.some((check) => check.status === "rejected"),
    )
  )
    return "unresolved";
  if (supplied.some((one) => one.status === "unjudged")) return "partially-checked";
  return "not-accepted";
}

/** What the process exits with for a status: the taxonomy in machine-output.ts, read one way. */
export function exitCodeForStatus(status: OutcomeStatus): number {
  return status === "accepted" || status === "unjudged"
    ? exitCodes.acceptable
    : status === "unverified"
      ? exitCodes.unavailable
      : exitCodes.notAcceptable;
}

const statusLine: Record<OutcomeStatus, string> = {
  // The scope line below says what the supplied requirements covered.
  accepted: "accepted",
  unjudged: "gates passed; the task itself was not judged (no requirement was supplied)",
  "partially-checked":
    "partially checked (nothing refused it; a requirement you supplied was decided by no check that ran)",
  unresolved:
    "unresolved (a generated check disagrees with the change; nothing decides which is wrong)",
  unverified:
    "unverified (the model or the verification environment was unavailable, so nothing established the change either way)",
  "not-accepted": "not accepted",
};

export function describeRunOutcome(input: RunOutcomeInput): readonly string[] {
  const lines: string[] = [];
  const say = (line = "") => lines.push(line);
  const status = outcomeStatus(input);
  const ok = exitCodeForStatus(status) === exitCodes.acceptable;
  const unresolved = input.unresolvedOutcomes ?? [];
  say();
  say(
    `outcome: ${statusLine[status]}` +
      (unresolved.length > 0 && ok
        ? `; this is the supplied contract's reading only: ${unresolved.length} requested outcome(s) read from the task were exercised by no check (below), so it does not show the whole task done`
        : ""),
  );
  say(`  requested: ${firstLine(input.task, 160)}`);
  say(
    `  verdict: task ${input.verdict.task}, regression ${input.verdict.behavioral}, ` +
      `policy ${input.verdict.policy}, execution ${input.verdict.executionTrust}; ` +
      `the loop stopped as ${input.lifecycle}`,
  );

  if (input.requirements === null) {
    say(
      "  requirements: none were sealed, so nothing here says the task was done; the gates say " +
        "only that nothing measured broke. Pass --goal-contract or --plan-checks to seal criteria.",
    );
  } else {
    const planned = input.requirements.filter((one) => one.source === "planned");
    const supplied = input.requirements.filter((one) => one.source !== "planned");
    const counts = countBy(supplied, (one) => one.status);
    say(
      `  requirements: ${supplied.length} supplied, ${counts.accepted ?? 0} met, ` +
        `${counts.rejected ?? 0} unmet, ${counts.unjudged ?? 0} unjudged` +
        (supplied.some((one) => one.authoredBy === "model")
          ? " (model-authored criteria are acceptance instruments, not independent ground truth)"
          : "") +
        (planned.length === 0
          ? ""
          : `; ${planned.length} planned from the task, hypotheses that generated checks exercise and that decide nothing`),
    );
    for (const requirement of input.requirements) {
      if (requirement.source === "planned") {
        describePlanned(
          requirement,
          say,
          input.uncovered?.find((one) => one.id === requirement.id),
          unresolved.filter((one) => one.requirement === requirement.id),
        );
        continue;
      }
      const mark =
        requirement.status === "accepted"
          ? "met"
          : requirement.status === "rejected"
            ? "UNMET"
            : "unjudged";
      say(
        `    ${mark.padEnd(8)} ${requirement.id}: ${firstLine(requirement.description, 100)}` +
          (requirement.authoredBy === "model" ? " [model-authored]" : "") +
          (requirement.detail === null || requirement.status === "accepted"
            ? ""
            : ` (${firstLine(requirement.detail, 140)})`),
      );
    }
    say(
      planned.length === 0
        ? "  scope: these are the requirements that were sealed; nothing checked the rest of the task's wording"
        : "  scope: only supplied requirements decide; a task sentence no requirement quotes was not tracked, and a quote says what a requirement is about, not that its checks test all of it",
    );
  }
  for (const requirement of input.uncheckedRequirements ?? [])
    say(
      `    unsupported ${requirement.id}: ${firstLine(requirement.description, 100)} [the planner's own, quoting no task sentence; no planned check held its base control, so it was not sealed]`,
    );

  say(
    `  tree: ${input.workspace}${input.branch === null ? "" : ` on ${input.branch}`}, measured against ${input.baseCommit.slice(0, 12)}`,
  );
  if (input.changedFiles.length === 0) say("  changed: nothing");
  else {
    say(
      `  changed: ${input.changedFiles.length} file(s)${input.diffTruncated ? " (diff truncated in the record)" : ""}`,
    );
    for (const path of input.changedFiles.slice(0, 20)) say(`    ${path}`);
    if (input.changedFiles.length > 20) say(`    ... ${input.changedFiles.length - 20} more`);
  }

  const gates = countBy(input.gates.runs, (run) => run.status);
  const notApplicable = input.gates.runs.filter((run) => run.status === "not-applicable");
  say(
    `  checks on that tree: ${gates.passed ?? 0} passed, ${gates.failed ?? 0} failed, ` +
      `${notApplicable.length} could not run` +
      (notApplicable.length === 0 ? "" : ` (${notApplicable.map((run) => run.gateId).join(", ")})`),
  );
  for (const reason of input.gates.coverageUnmeasured.slice(0, 3))
    say(`    coverage unmeasured: ${firstLine(reason, 140)}`);
  if (input.finalVerification !== null) {
    if (input.finalVerification.refusal !== null)
      say(`    final verification refused: ${firstLine(input.finalVerification.refusal, 160)}`);
    else
      say(
        `    final verification of the exact tree in a fresh checkout: regression ${input.finalVerification.regression}` +
          (input.finalVerification.unmeasured ? ", unmeasured" : "") +
          (input.finalVerification.advice.length > 0
            ? `; ${firstLine(input.finalVerification.advice, 140)}`
            : ""),
      );
  }

  const usage = input.usage;
  say(
    `  used: ${formatElapsed(usage.durationMs)}, ${usage.steps} steps, ${formatTokens(usage.tokensUsed)}` +
      (usage.callsWithUnknownUsage > 0
        ? ` (a lower bound: ${usage.callsWithUnknownUsage} call(s) reported no usage)`
        : "") +
      `, ${formatCost(usage.costUsd)}` +
      (usage.setup === null
        ? ""
        : `; of which planning and criteria ${formatElapsed(usage.setup.durationMs)}, ${formatTokens(usage.setup.tokensUsed)}`),
  );

  const i = input.interventions;
  const automatic = [
    i.repairAttempts > 0 ? `${i.repairAttempts} repair attempt(s)` : null,
    i.stallNotices > 0 ? `${i.stallNotices} repeated-call notice(s)` : null,
    i.stallStops > 0 ? `${i.stallStops} stop(s) for repeated calls` : null,
    i.escalations > 0 ? `${i.escalations} model escalation(s)` : null,
    i.promptsPreApproved > 0
      ? `${i.promptsPreApproved} prompt(s) answered by the approval mode`
      : null,
  ].filter((one): one is string => one !== null);
  const external = [
    i.promptsAnsweredByPerson > 0 ? `${i.promptsAnsweredByPerson} prompt(s) answered by you` : null,
    i.promptsDeclined > 0 ? `${i.promptsDeclined} declined` : null,
  ].filter((one): one is string => one !== null);
  say(
    `  interventions: ${external.length === 0 ? "none by a person" : external.join(", ")}; ` +
      `automatic: ${automatic.length === 0 ? "none" : automatic.join(", ")}`,
  );

  const shaped = input.repairsForGeneratedChecksOnly ?? [];
  if (shaped.length > 0)
    say(
      `  repaired for generated checks alone: attempt(s) ${shaped.join(", ")} changed the code when only a generated check disagreed; their expectations are the planner's, so review what those repairs changed against the task`,
    );

  if (!ok) {
    if (status === "not-accepted")
      say(`  blocked by: ${firstLine(blockingReason(input.verdict), 400)}`);
    say(`  next: ${nextAction(input)}`);
  }
  return lines;
}

/** A planned requirement: what it quotes, and what its generated checks did, never a verdict. */
function describePlanned(
  requirement: RequirementOutcome,
  say: (line: string) => void,
  uncovered?: NonNullable<RunOutcomeInput["uncovered"]>[number],
  unresolved: readonly UnresolvedOutcomeReport[] = [],
): void {
  const checks = requirement.generatedChecks ?? [];
  const disagreeing = checks.filter((one) => one.status === "rejected");
  const mark = disagreeing.length > 0 ? "DISPUTED" : checks.length === 0 ? "no check" : "unjudged";
  say(
    `    ${mark.padEnd(8)} ${requirement.id}: ${firstLine(requirement.description, 100)}` +
      (requirement.quote == null
        ? " [planned; quotes no task sentence]"
        : ` [planned from the task: "${firstLine(requirement.quote, 80)}"]`),
  );
  if (checks.length === 0) {
    if (uncovered === undefined)
      say("             no generated check held its base control, so nothing exercised it");
    else {
      say(`             no generated check covers it: ${firstLine(uncovered.reason, 400)}`);
      say(`             next for it: ${firstLine(uncovered.nextAction, 400)}`);
    }
    // Its outcomes' own words: the requirement's quote is whichever check declared it last, and
    // the launch that found this lost the task's example sentence from the report that way.
    for (const one of unresolved)
      say(
        `             NO CHECK ${one.role === "change" ? "change" : "kept behaviour"}${one.quote === null ? " (quoting nothing)" : ` "${firstLine(one.quote, 160)}"`}`,
      );
    return;
  }
  for (const check of checks)
    say(
      `             generated check ${check.id}: ${check.status === "accepted" ? "agrees with the change" : check.status === "rejected" ? "disagrees" : check.status}` +
        (check.status === "accepted" ? "" : ` (${firstLine(check.detail, 120)})`) +
        "; its expected results are the planner's",
    );
  // The checks above state other outcomes of this requirement; these have none.
  for (const one of unresolved) {
    say(
      `             NO CHECK ${one.role === "change" ? "change" : "kept behaviour"}${one.quote === null ? "" : ` "${firstLine(one.quote, 100)}"`}: ${firstLine(one.reason, 400)}`,
    );
    say(`             next for it: ${firstLine(one.nextAction, 400)}`);
  }
}

function nextAction(input: RunOutcomeInput): string {
  if (input.resumable)
    return `swarm resume ${input.runId} continues under the original budget; nothing is re-spent`;
  const unmet = (input.requirements ?? []).filter((one) => one.status === "rejected");
  if (unmet.length > 0)
    return `review the change for ${unmet.map((one) => one.id).join(", ")}, then run the task again or finish it by hand; the sealed checks are in the bundle`;
  const status = outcomeStatus(input);
  const planned = (input.requirements ?? []).filter((one) => one.source === "planned");
  if (status === "unresolved")
    return `read the disputed requirement(s) ${planned
      .filter((one) => one.generatedChecks?.some((check) => check.status === "rejected"))
      .map((one) => one.id)
      .join(
        ", ",
      )} against the task: either the generated check expects something the task does not ask for, or the change is incomplete; decide, then fix the code or keep it`;
  if (status === "partially-checked")
    return `give ${(input.requirements ?? [])
      .filter((one) => one.source !== "planned" && one.status === "unjudged")
      .map((one) => one.id)
      .join(
        ", ",
      )} a check that decides it in --goal-contract and run again, or review the change against it by hand`;
  if (status === "unverified" && input.lifecycle !== "model-error")
    return "the final verification could not measure the change in a fresh checkout (its line above names why); prepare what it names, then run again";
  if (input.finalVerification?.refusal !== null && input.finalVerification !== null)
    return "fix what the refusal names (the environment, the lockfile or the path the run promised not to touch), then run again";
  const owed = input.gates.advisoryFailures.filter(
    (run) => run.measures.justificationRequired === 1,
  );
  if (input.gates.blockingFailures.length === 0 && owed.length > 0)
    return `review the size the ${owed.map((run) => run.gateId).join(", ")} gate asked to have justified; the change is in the bundle, and a smaller change or a justified one can be accepted`;
  if (input.gates.blockingFailures.length > 0)
    return `fix the failing ${input.gates.blockingFailures.map((run) => run.gateId).join(", ")} check(s) and run again, or review the bundle`;
  if (input.lifecycle === "model-error")
    return "the model could not be reached or answered with an error (the model error above names it); check that the server is running and that --model and --local-endpoint name it, then run again";
  if (input.changedFiles.length === 0)
    return "the run changed nothing; give it a more specific task or a stronger model";
  return "review the bundle; what the gates could not measure is named above";
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

function firstLine(text: string, width: number): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > width ? `${line.slice(0, width - 3)}...` : line;
}

/** The files a recorded workspace diff touches, read off its patch headers. */
export function changedFilesOf(patch: string): readonly string[] {
  const files = new Set<string>();
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header !== null) files.add(header[2] ?? header[1] ?? "");
  }
  return [...files].filter((path) => path.length > 0);
}

/**
 * Requirement outcomes, from the sealed contract and the final verification's obligations. The
 * contract gives the words and the authorship; the verification gives the status; the check
 * results give the first-line detail of what refused.
 */
export function requirementOutcomes(
  contract: GoalContract,
  verification:
    | {
        readonly goalAcceptance?: {
          readonly obligations: readonly { id: string; status: string }[];
          readonly checkResults?: readonly { id: string; status: string; detail: string }[];
        };
      }
    | undefined,
): readonly RequirementOutcome[] {
  const statuses = new Map(
    (verification?.goalAcceptance?.obligations ?? []).map((one) => [one.id, one.status]),
  );
  const details = new Map(
    (verification?.goalAcceptance?.checkResults ?? [])
      .filter((check) => check.status !== "accepted")
      .map((check) => [check.id, check.detail]),
  );
  const results = new Map(
    (verification?.goalAcceptance?.checkResults ?? []).map((check) => [check.id, check]),
  );
  return contract.requirements.map((requirement) => {
    const status = statuses.get(requirement.id);
    const detail = requirement.checks
      .map((id) => details.get(id))
      .find((one): one is string => typeof one === "string" && one.length > 0);
    const planned = requirement.planned;
    return {
      id: requirement.id,
      description: requirement.description,
      status:
        status === "accepted" || status === "rejected" || status === "unjudged"
          ? status
          : "unjudged",
      authoredBy:
        planned !== undefined ||
        requirement.checks.some(
          (id) => contract.checks.find((check) => check.id === id)?.author === "model",
        )
          ? "model"
          : "user",
      detail: detail ?? null,
      ...(planned === undefined
        ? { source: "supplied" as const }
        : {
            source: "planned" as const,
            quote: planned.quote ?? null,
            generatedChecks: planned.diagnostics.map((id) => {
              const result = results.get(id);
              const known = ["accepted", "rejected", "unjudged"] as const;
              return {
                id,
                status: known.find((one) => one === result?.status) ?? ("not-run" as const),
                detail: result?.detail ?? "no result was recorded for it",
              };
            }),
          }),
    };
  });
}

/** How many interventions the chain records, by who made them. */
export function interventionsOn(evidence: EvidenceRecorder): InterventionCounts {
  const payloads = evidence.payloads();
  let repairAttempts = 0;
  let stallNotices = 0;
  let stallStops = 0;
  let escalations = 0;
  let promptsAnsweredByPerson = 0;
  let promptsPreApproved = 0;
  let promptsDeclined = 0;
  for (const record of evidence.records()) {
    const payload = payloads.get(record.payloadDigest) as
      | {
          rule?: string;
          intervention?: string;
          scope?: string;
          outcome?: string;
          decidedBy?: string;
          phase?: string;
        }
      | undefined;
    if (record.type === "ratchet-decision" && payload?.scope === "retry") repairAttempts += 1;
    if (record.type === "session-budget" && payload?.rule === "tool-stall-v1") {
      if (payload.intervention === "feedback") stallNotices += 1;
      else if (payload.intervention === "stop") stallStops += 1;
    }
    if (
      record.type === "session-budget" &&
      payload?.rule === "capability-escalation-v1" &&
      payload.phase === "intent"
    )
      escalations += 1;
    if (record.type === "confirmation") {
      if (payload?.outcome === "pre-approved") promptsPreApproved += 1;
      else if (payload?.outcome === "declined" && payload.decidedBy === "user") {
        promptsDeclined += 1;
        promptsAnsweredByPerson += 1;
      } else if (payload?.decidedBy === "user") promptsAnsweredByPerson += 1;
    }
  }
  return {
    repairAttempts,
    stallNotices,
    stallStops,
    escalations,
    promptsAnsweredByPerson,
    promptsPreApproved,
    promptsDeclined,
  };
}

/**
 * The accepted repair attempts that began with nothing failing but generated checks: the
 * diagnostics gate was the only blocking gate failing. Each attempt starts from the last accepted
 * cycle, so that is the cycle read for it.
 */
export function repairsForGeneratedChecksOnly(
  outcome: Pick<AutoResolveOutcome, "firstCycle" | "attempts">,
): readonly number[] {
  const asked: number[] = [];
  let current = outcome.firstCycle;
  for (const attempt of outcome.attempts) {
    const failing = current.blockingFailures;
    if (
      attempt.decision.accepted &&
      failing.length > 0 &&
      failing.every((run) => run.gateId === diagnosticsGateId)
    )
      asked.push(attempt.attempt);
    if (attempt.decision.accepted) current = attempt.cycle;
  }
  return asked;
}
