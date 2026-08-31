import type { LoopEvent } from "../core/loop-events.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { type AttemptSummary, type EscalationPayload, escalationSchema } from "./escalation.ts";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import {
  describeFailuresForModel,
  type GateCycle,
  type GateCycleDependencies,
  isGreen,
  measuredTheChange,
  runGateCycle,
} from "./gate-runner.ts";
import {
  type MeasureSnapshot,
  measuresAtBase,
  measuresFor,
  takeMeasureSnapshot,
} from "./measure-snapshot.ts";
import { isTestFile } from "./measures.ts";
import { judgeRatchet, type RatchetDecision, ratchetPayload } from "./ratchet.ts";
import {
  type BaseControlRunner,
  clearedTests,
  findNewSpecifications,
  type RespecificationCandidate,
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

interface AutoResolveDependencies {
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
  /**
   * Stops the loop where a run was cancelled. Without it every remaining attempt still ran,
   * each one resolving instantly to "interrupted after 0 steps" against a signal that was
   * already aborted, and the run then escalated at a gate nobody had been given a chance to
   * fix. Three attempts were spent saying the same thing about a run that was already over.
   */
  readonly abortSignal?: AbortSignal;
}

interface AutoResolveAttempt {
  readonly attempt: number;
  readonly cycle: GateCycle;
  readonly decision: RatchetDecision;
  readonly respecification: readonly RespecificationFinding[];
  readonly ratchetRecord: string;
}

/** The final workspace judged against the base commit, which happens on every run. */
export interface BaseComparison {
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
  readonly baseComparison: BaseComparison;
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
 *
 * Whatever the retries did, the state this returns in is then judged against the base commit.
 * Without that, a run whose very first edit deleted the failing tests goes green on the first
 * cycle and no numeric comparison ever happens: the ratchet only ever saw retries, and there
 * were none.
 */
export async function runAutoResolve(deps: AutoResolveDependencies): Promise<AutoResolveOutcome> {
  const trackedTestFiles = new Set<string>();

  let context = await deps.context();
  trackTestFiles(context, trackedTestFiles);

  let cycle = await runGateCycle(deps.gates, context, 0, deps.cycleDeps);
  const firstCycle = cycle;
  let baseline = await snapshot(context, cycle, trackedTestFiles);

  const attempts: AutoResolveAttempt[] = [];

  while (!isGreen(cycle) && attempts.length < deps.cap && deps.abortSignal?.aborted !== true) {
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

    const respecification = await findNewSpecifications(
      regressedTestFiles(baseline, candidate),
      deps.baseControl,
    );

    const input = {
      baselineGates: cycle.statuses,
      candidateGates: candidateCycle.statuses,
      baseline,
      candidate,
      newSpecifications: clearedTests(respecification),
    };
    const decision = judgeRatchet(input);
    const recorded = await deps.evidence.record({
      type: "ratchet-decision",
      actor: "harness",
      provenance: ["tool-output"],
      payload: ratchetPayload("retry", attempt, input, decision, respecification),
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

  const baseComparison = await judgeAgainstBase(deps, cycle, baseline);

  if (isGreen(cycle) && baseComparison.decision.accepted) {
    return {
      settled: "green",
      firstCycle,
      finalCycle: cycle,
      finalMeasures: baseline,
      attempts,
      baseComparison,
      escalation: null,
    };
  }

  const escalation = await escalate(deps, cycle, attempts, baseComparison);
  return {
    settled: "escalated",
    firstCycle,
    finalCycle: cycle,
    finalMeasures: baseline,
    attempts,
    baseComparison,
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
      // What the runner's relative file names are relative to, so a report's spelling of a
      // path and the change's spelling of it resolve to one file or to none.
      workspaceRoot: forContext.workspaceRoot,
      trackedTestFiles: tracked,
      coverageReports: forCycle.coverageReports,
      testReports: forCycle.testReports,
    });
  }
}

/**
 * The final state against the base commit, unconditionally. The suite was never run at the
 * base, so the collected count and the coverage ratio abstain by name rather than being
 * invented; what does compare is what the test files themselves declare, which is exactly
 * what a deletion moves.
 */
async function judgeAgainstBase(
  deps: AutoResolveDependencies,
  cycle: GateCycle,
  final: MeasureSnapshot,
): Promise<BaseComparison> {
  const base = measuresAtBase(final);
  const respecification = await findNewSpecifications(
    regressedTestFiles(base, final),
    deps.baseControl,
  );
  const input = {
    // Nothing is known to have passed at the base commit, so no gate result is compared here.
    baselineGates: {},
    candidateGates: cycle.statuses,
    baseline: base,
    candidate: final,
    newSpecifications: clearedTests(respecification),
  };

  const decision = judgeRatchet(input);
  const recorded = await deps.evidence.record({
    type: "ratchet-decision",
    actor: "harness",
    provenance: ["tool-output"],
    payload: ratchetPayload("base", 0, input, decision, respecification),
  });

  return { decision, respecification, ratchetRecord: recorded.record.payloadDigest };
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
    newSpecifications: new Set<string>(),
  };
  const decision: RatchetDecision = {
    accepted: false,
    violations: [],
    abstentions: [],
    newSpecifications: [],
    detail: `the attempt produced nothing to judge: ${failure}`,
  };

  const recorded = await deps.evidence.record({
    type: "ratchet-decision",
    actor: "harness",
    provenance: ["tool-output"],
    payload: ratchetPayload("retry", attempt, input, decision, []),
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
 *
 * Each one carries the tests that are new in it, since only a test the base did not have can
 * be a new specification: the run's own failing test would otherwise buy a deletion.
 */
function regressedTestFiles(
  baseline: MeasureSnapshot,
  candidate: MeasureSnapshot,
): readonly RespecificationCandidate[] {
  const regressed: RespecificationCandidate[] = [];
  for (const path of Object.keys(candidate.perTestFile)) {
    const before = measuresFor(baseline, candidate, path);
    const after = measuresFor(candidate, baseline, path);
    if (
      after.tests < before.tests ||
      after.assertions < before.assertions ||
      after.skips > before.skips
    ) {
      regressed.push({
        file: path,
        newTests: Object.keys(after.perTest).filter((name) => !(name in before.perTest)),
      });
    }
  }
  return regressed.sort((left, right) => (left.file < right.file ? -1 : 1));
}

async function escalate(
  deps: AutoResolveDependencies,
  cycle: GateCycle,
  attempts: readonly AutoResolveAttempt[],
  base: BaseComparison,
): Promise<EscalationPayload> {
  const blocking = cycle.blockingFailures[0];
  const rejected = attempts.filter((attempt) => !attempt.decision.accepted);
  // A run can reach here with every gate green and the base comparison rejected, which is
  // the erosion a cap-bounded retry loop never saw because it never had to retry.
  const eroded = base.decision.accepted ? null : base;

  const history: AttemptSummary[] = attempts.map((attempt) => ({
    attempt: attempt.attempt,
    ratchetAccepted: attempt.decision.accepted,
    ratchetDetail: attempt.decision.detail,
    blockingFailures: attempt.cycle.blockingFailures.map((run) => run.gateId),
    gateRecords: attempt.cycle.runs.map((run) => run.record),
  }));

  // A run can now end ungreen with no gate objecting: every gate that runs a command stood
  // down, so nothing executed the change. Naming that is the difference between an escalation
  // a reader can act on and one that says "gate unknown (unknown)" with an empty record.
  const unmeasured = !measuredTheChange(cycle);
  const payload = escalationSchema.parse({
    gateId:
      blocking?.gateId ?? (unmeasured ? "unmeasured" : eroded === null ? "unknown" : "ratchet"),
    title:
      blocking?.title ??
      (unmeasured
        ? "nothing ran over this change"
        : eroded === null
          ? "unknown"
          : "the ratchet against the base commit"),
    reason:
      blocking?.detail ??
      (unmeasured
        ? `${cycle.measures.changedFiles ?? 0} file(s) changed and every gate that runs a ` +
          "command stood down, so nothing executed them. The work is not in a shape this " +
          "project's own test command can run."
        : eroded === null
          ? "the run stopped with a blocking failure that is no longer in the final cycle"
          : eroded.decision.detail),
    attemptsUsed: attempts.length,
    cap: deps.cap,
    attemptsRejectedByRatchet: rejected.length + (eroded === null ? 0 : 1),
    lastGateRecord: blocking?.record ?? eroded?.ratchetRecord ?? "",
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
      recordKind: "escalation",
      narrative: `Auto-resolve stopped at the ${payload.gateId} gate: ${payload.reason}`,
    },
    "harness",
  );

  return payload;
}
