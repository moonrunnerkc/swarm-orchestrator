import type { LoopEvent } from "../core/loop-events.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { type AttemptSummary, type EscalationPayload, escalationSchema } from "./escalation.ts";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import {
  describeFailuresForModel,
  type GateCycle,
  type GateCycleDependencies,
  isGreen,
  runGateCycle,
} from "./gate-runner.ts";
import { type MeasureSnapshot, measuresFor, takeMeasureSnapshot } from "./measure-snapshot.ts";
import { isTestFile } from "./measures.ts";
import { judgeRatchet, type RatchetDecision, ratchetPayload } from "./ratchet.ts";
import {
  type BaseControlRunner,
  findExemptFiles,
  type RespecificationFinding,
} from "./respecification.ts";
import type { WorkspaceCheckpoint } from "./workspace-changes.ts";

export interface ResolveRequest {
  readonly attempt: number;
  readonly cap: number;
  /** The gates' own bytes, not a summary of them. */
  readonly gateOutput: string;
  readonly cycle: GateCycle;
}

/** Hands the failure back to whatever is doing the fixing, and returns when it has tried. */
export type ResolveAttempt = (request: ResolveRequest) => Promise<void>;

export interface AutoResolveDependencies {
  readonly gates: readonly GateDefinition[];
  /** Recomputed per attempt: the diff, the declared set, and the budgets all move. */
  readonly context: () => Promise<GateContext>;
  readonly cycleDeps: GateCycleDependencies;
  readonly evidence: EvidenceRecorder;
  readonly checkpoint: WorkspaceCheckpoint;
  /** Null disables the escape hatch, which makes the ratchet stricter, never looser. */
  readonly baseControl: BaseControlRunner | null;
  readonly resolve: ResolveAttempt;
  readonly emit: (event: LoopEvent) => void;
  readonly cap: number;
}

export interface AutoResolveAttempt {
  readonly attempt: number;
  readonly cycle: GateCycle;
  readonly decision: RatchetDecision;
  readonly respecification: readonly RespecificationFinding[];
  readonly ratchetRecord: string;
}

export interface AutoResolveOutcome {
  readonly settled: "green" | "escalated";
  readonly firstCycle: GateCycle;
  /** The gate cycle whose state the workspace is in when this returns. */
  readonly finalCycle: GateCycle;
  /** The numbers as they stand in that state, for the run's own report. */
  readonly finalMeasures: MeasureSnapshot;
  readonly attempts: readonly AutoResolveAttempt[];
  readonly escalation: EscalationPayload | null;
}

export const defaultAttemptCap = 3;

/**
 * The section 3.6 fixed-point search. Run the gates; on a blocking failure hand the raw
 * output back and try again; judge each retry against the previous state with the numeric
 * ratchet; stop at the cap.
 *
 * A rejected attempt is undone. That is what turns a retry loop into monotone progress: an
 * oscillation cannot ping-pong between two states, because the state that traded a number
 * the wrong way never becomes the baseline the next attempt starts from. The attempt still
 * counts against the cap, so a model that keeps offering the same trade escalates quickly
 * instead of burning the budget.
 */
export async function runAutoResolve(deps: AutoResolveDependencies): Promise<AutoResolveOutcome> {
  const trackedTestFiles = new Set<string>();

  let context = await deps.context();
  trackTestFiles(context, trackedTestFiles);

  let cycle = await runGateCycle(deps.gates, context, 0, deps.cycleDeps);
  const firstCycle = cycle;
  let baseline = await snapshot(context, cycle, trackedTestFiles);

  const attempts: AutoResolveAttempt[] = [];

  while (!isGreen(cycle) && attempts.length < deps.cap) {
    const attempt = attempts.length + 1;
    deps.emit({ type: "attempt", attempt, cap: deps.cap });

    const before = await deps.checkpoint.capture(`before attempt ${attempt}`);
    const failure = await tryResolve(deps, {
      attempt,
      cap: deps.cap,
      gateOutput: describeFailuresForModel(cycle),
      cycle,
    });

    if (failure !== null) {
      // The workspace is in an unknown state after a failed attempt, so it goes back to the
      // last accepted one. The attempt still counts: a resolver that cannot run is not a
      // free retry.
      await deps.checkpoint.restore(before);
      attempts.push(await recordFailedAttempt(deps, attempt, cycle, baseline, failure));
      continue;
    }

    const candidateContext = await deps.context();
    trackTestFiles(candidateContext, trackedTestFiles);
    const candidateCycle = await runGateCycle(
      deps.gates,
      candidateContext,
      attempt,
      deps.cycleDeps,
    );
    const candidate = await snapshot(candidateContext, candidateCycle, trackedTestFiles);

    const respecification = await findExemptFiles(
      regressedTestFiles(baseline, candidate),
      deps.baseControl,
    );
    const exemptFiles = new Set(
      respecification.filter((finding) => finding.exempt).map((finding) => finding.file),
    );

    const input = {
      baselineGates: cycle.statuses,
      candidateGates: candidateCycle.statuses,
      baseline,
      candidate,
      exemptFiles,
    };
    const decision = judgeRatchet(input);
    const recorded = await deps.evidence.record({
      type: "ratchet-decision",
      actor: "harness",
      provenance: ["tool-output"],
      payload: ratchetPayload(attempt, input, decision, respecification),
    });

    deps.emit({
      type: "ratchet",
      attempt,
      accepted: decision.accepted,
      detail: decision.detail,
      record: recorded.record.payloadDigest,
    });

    attempts.push({
      attempt,
      cycle: candidateCycle,
      decision,
      respecification,
      ratchetRecord: recorded.record.payloadDigest,
    });

    if (!decision.accepted) {
      await deps.checkpoint.restore(before);
      continue;
    }

    context = candidateContext;
    cycle = candidateCycle;
    baseline = candidate;
  }

  if (isGreen(cycle)) {
    return {
      settled: "green",
      firstCycle,
      finalCycle: cycle,
      finalMeasures: baseline,
      attempts,
      escalation: null,
    };
  }

  const escalation = await escalate(deps, cycle, attempts);
  return {
    settled: "escalated",
    firstCycle,
    finalCycle: cycle,
    finalMeasures: baseline,
    attempts,
    escalation,
  };

  async function snapshot(
    forContext: GateContext,
    forCycle: GateCycle,
    tracked: ReadonlySet<string>,
  ): Promise<MeasureSnapshot> {
    return takeMeasureSnapshot({
      changes: forContext.changes,
      probe: forContext.probe,
      trackedTestFiles: tracked,
      gateMeasures: forCycle.measures,
      gateOutputs: forCycle.runs.map((run) => run.observation),
    });
  }
}

async function tryResolve(
  deps: AutoResolveDependencies,
  request: ResolveRequest,
): Promise<string | null> {
  try {
    await deps.resolve(request);
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/** An attempt that never produced a candidate still gets a decision record, and is rejected. */
async function recordFailedAttempt(
  deps: AutoResolveDependencies,
  attempt: number,
  cycle: GateCycle,
  baseline: MeasureSnapshot,
  failure: string,
): Promise<AutoResolveAttempt> {
  const input = {
    baselineGates: cycle.statuses,
    candidateGates: cycle.statuses,
    baseline,
    candidate: baseline,
    exemptFiles: new Set<string>(),
  };
  const decision: RatchetDecision = {
    accepted: false,
    violations: [],
    abstentions: [],
    exemptFiles: [],
    detail: `the attempt produced nothing to judge: ${failure}`,
  };

  const recorded = await deps.evidence.record({
    type: "ratchet-decision",
    actor: "harness",
    provenance: ["tool-output"],
    payload: ratchetPayload(attempt, input, decision, []),
  });

  deps.emit({
    type: "ratchet",
    attempt,
    accepted: false,
    detail: decision.detail,
    record: recorded.record.payloadDigest,
  });

  return {
    attempt,
    cycle,
    decision,
    respecification: [],
    ratchetRecord: recorded.record.payloadDigest,
  };
}

function trackTestFiles(context: GateContext, tracked: Set<string>): void {
  for (const file of context.changes.files) {
    if (isTestFile(file.path)) {
      tracked.add(file.path);
    }
  }
}

/**
 * Only files that moved a number the wrong way are worth a control run. Every control costs
 * a test execution, and an exemption changes nothing for a file that did not regress.
 */
function regressedTestFiles(
  baseline: MeasureSnapshot,
  candidate: MeasureSnapshot,
): readonly string[] {
  const regressed: string[] = [];
  for (const path of Object.keys(candidate.perTestFile)) {
    const before = measuresFor(baseline, candidate, path);
    const after = measuresFor(candidate, baseline, path);
    if (
      after.tests < before.tests ||
      after.assertions < before.assertions ||
      after.skips > before.skips
    ) {
      regressed.push(path);
    }
  }
  return regressed.sort();
}

async function escalate(
  deps: AutoResolveDependencies,
  cycle: GateCycle,
  attempts: readonly AutoResolveAttempt[],
): Promise<EscalationPayload> {
  const blocking = cycle.blockingFailures[0];
  const rejected = attempts.filter((attempt) => !attempt.decision.accepted);

  const history: AttemptSummary[] = attempts.map((attempt) => ({
    attempt: attempt.attempt,
    ratchetAccepted: attempt.decision.accepted,
    ratchetDetail: attempt.decision.detail,
    blockingFailures: attempt.cycle.blockingFailures.map((run) => run.gateId),
    gateRecords: attempt.cycle.runs.map((run) => run.record),
  }));

  const payload = escalationSchema.parse({
    gateId: blocking?.gateId ?? "unknown",
    title: blocking?.title ?? "unknown",
    reason:
      blocking === undefined
        ? "the run stopped with a blocking failure that is no longer in the final cycle"
        : blocking.detail,
    attemptsUsed: attempts.length,
    cap: deps.cap,
    attemptsRejectedByRatchet: rejected.length,
    lastGateRecord: blocking?.record ?? "",
    history,
  });

  const recorded = await deps.evidence.record({
    type: "escalation",
    actor: "harness",
    provenance: ["tool-output"],
    payload,
  });

  deps.emit({
    type: "escalated",
    gateId: payload.gateId,
    detail: payload.reason,
    attempts: attempts.length,
  });

  // The escalation is itself a checkable claim, so the bundle carries one green statement
  // about why it stopped rather than a paragraph a reviewer has to take on faith.
  await deps.evidence.submitClaim(
    {
      predicate: `attemptsUsed == ${payload.attemptsUsed} && cap == ${payload.cap}`,
      record: recorded.record.payloadDigest,
      narrative: `Auto-resolve stopped at the ${payload.gateId} gate: ${payload.reason}`,
    },
    "harness",
  );

  return payload;
}
