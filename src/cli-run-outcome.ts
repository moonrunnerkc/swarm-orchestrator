import type { GoalContract } from "./evidence/goal-contract.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { blockingReason, type RunVerdict } from "./evidence/verdict.ts";
import type { GateCycle } from "./gates/gate-runner.ts";
import type {
  FinalVerificationOutcome,
  InterventionCounts,
  RequirementOutcome,
  RunOutcomeReport,
  SetupUsage,
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
export type { RequirementOutcome } from "./run-outcome-shape.ts";

export interface RunOutcomeInput {
  readonly task: string;
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

export function describeRunOutcome(input: RunOutcomeInput): readonly string[] {
  const lines: string[] = [];
  const say = (line = "") => lines.push(line);
  const ok = input.verdict.acceptable;
  say();
  say(`outcome: ${ok ? "accepted" : "not accepted"}`);
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
    const counts = countBy(input.requirements, (one) => one.status);
    say(
      `  requirements: ${input.requirements.length} sealed, ${counts.accepted ?? 0} met, ` +
        `${counts.rejected ?? 0} unmet, ${counts.unjudged ?? 0} unjudged` +
        (input.requirements.some((one) => one.authoredBy === "model")
          ? " (model-authored criteria are acceptance instruments, not independent ground truth)"
          : ""),
    );
    for (const requirement of input.requirements) {
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
  }
  for (const requirement of input.uncheckedRequirements ?? [])
    say(
      `    unchecked ${requirement.id}: ${firstLine(requirement.description, 100)} [model-authored; no planned check held its base control, so it was not sealed or judged]`,
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

  if (!ok) {
    say(`  blocked by: ${firstLine(blockingReason(input.verdict), 400)}`);
    say(`  next: ${nextAction(input)}`);
  }
  return lines;
}

function nextAction(input: RunOutcomeInput): string {
  if (input.resumable)
    return `swarm resume ${input.runId} continues under the original budget; nothing is re-spent`;
  const unmet = (input.requirements ?? []).filter((one) => one.status === "rejected");
  if (unmet.length > 0)
    return `review the change for ${unmet.map((one) => one.id).join(", ")}, then run the task again or finish it by hand; the sealed checks are in the bundle`;
  if (input.finalVerification?.refusal !== null && input.finalVerification !== null)
    return "fix what the refusal names (the environment, the lockfile or the path the run promised not to touch), then run again";
  const owed = input.gates.advisoryFailures.filter(
    (run) => run.measures.justificationRequired === 1,
  );
  if (input.gates.blockingFailures.length === 0 && owed.length > 0)
    return `review the size the ${owed.map((run) => run.gateId).join(", ")} gate asked to have justified; the change is in the bundle, and a smaller change or a justified one can be accepted`;
  if (input.gates.blockingFailures.length > 0)
    return `fix the failing ${input.gates.blockingFailures.map((run) => run.gateId).join(", ")} check(s) and run again, or review the bundle`;
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
  return contract.requirements.map((requirement) => {
    const status = statuses.get(requirement.id);
    const detail = requirement.checks
      .map((id) => details.get(id))
      .find((one): one is string => typeof one === "string" && one.length > 0);
    return {
      id: requirement.id,
      description: requirement.description,
      status:
        status === "accepted" || status === "rejected" || status === "unjudged"
          ? status
          : "unjudged",
      authoredBy: requirement.checks.some(
        (id) => contract.checks.find((check) => check.id === id)?.author === "model",
      )
        ? "model"
        : "user",
      detail: detail ?? null,
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
