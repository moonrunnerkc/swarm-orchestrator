import { z } from "zod";
import type { Clock } from "../core/clock.ts";
import type { GateStatus, LoopEvent } from "../core/loop-events.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { assembleGates, type GateSetOptions } from "../gates/default-gates.ts";
import { defaultDiffBudget } from "../gates/engine.ts";
import type { FileSetRegistry } from "../gates/file-set.ts";
import type { GateContext, GateDefinition } from "../gates/gate-definition.ts";
import {
  describeFailuresForModel,
  type GateCycle,
  isGreen,
  runGateCycle,
} from "../gates/gate-runner.ts";
import { createGitWorkspaceProbe } from "../gates/git-workspace.ts";
import { type MeasureSnapshot, takeMeasureSnapshot } from "../gates/measure-snapshot.ts";
import { isTestFile } from "../gates/measures.ts";
import { createNodeCommandRunner } from "../gates/node-command-runner.ts";
import { detectProject } from "../gates/project-type.ts";
import { judgeRatchet, type RatchetDecision } from "../gates/ratchet.ts";
import { headCommit, mergeBranch, resetHard } from "./worktree.ts";

/** Why a proposal did not land. Each one is handed back with the output that produced it. */
export type RejectionReason = "merge-conflict" | "gates" | "ratchet";

export interface QueueCandidate {
  readonly workerId: string;
  readonly branch: string;
  readonly task: string;
  /** What this worker declared it would touch. The queue declares the union. */
  readonly declaredFiles: readonly string[];
  /** The worker's own chain, so a rejection is returned to it and not only reported. */
  readonly evidence: EvidenceRecorder;
}

export interface QueueLanding {
  readonly workerId: string;
  readonly branch: string;
  readonly landed: boolean;
  readonly reason: RejectionReason | null;
  /** Git's conflict text or the gates' own bytes. What the worker would act on. */
  readonly feedback: string;
  /** The integration commit this landing produced, or null when nothing landed. */
  readonly commit: string | null;
  readonly cycle: GateCycle | null;
  readonly decision: RatchetDecision | null;
  readonly record: string;
}

export interface MergeQueueResult {
  readonly baseCommit: string;
  /** Where the integration branch stands when the queue is done. */
  readonly headCommit: string;
  readonly landings: readonly QueueLanding[];
  /** The gates as they stood before anything merged, which the ratchet measures against. */
  readonly baseCycle: GateCycle;
}

export interface MergeQueueOptions {
  readonly integrationPath: string;
  readonly baseCommit: string;
  /** Proposals in the order they will be tried. Order is the queue. */
  readonly candidates: readonly QueueCandidate[];
  readonly evidence: EvidenceRecorder;
  readonly fileSet: FileSetRegistry;
  readonly clock: Clock;
  readonly emit: (event: LoopEvent) => void;
  readonly gateOptions?: GateSetOptions;
}

export const mergeAttemptSchema = z.object({
  workerId: z.string().min(1),
  branch: z.string().min(1),
  position: z.number().int().positive(),
  landed: z.boolean(),
  reason: z.enum(["merge-conflict", "gates", "ratchet"]).nullable(),
  detail: z.string(),
  commit: z.string().nullable(),
  conflictingPaths: z.array(z.string()),
  gateRecords: z.array(z.string()),
  blockingFailures: z.array(z.string()),
  ratchetAccepted: z.boolean().nullable(),
  ratchetDetail: z.string().nullable(),
});

export type MergeAttemptPayload = z.infer<typeof mergeAttemptSchema>;

/**
 * Workers propose, gates arbitrate, one at a time. Sequential is the whole point: a merge is
 * only allowed to land after the full gate set has run on the tree it produced, so the state
 * every later candidate is measured against is a state that was itself measured.
 *
 * The ratchet runs across the queue exactly as it runs across auto-resolve attempts, and for
 * the same reason: two changes that are each green on their own can still leave the tree with
 * fewer tests than it started with, and a boolean gate cannot see that.
 */
export async function runMergeQueue(options: MergeQueueOptions): Promise<MergeQueueResult> {
  const probe = createGitWorkspaceProbe({
    workspaceRoot: options.integrationPath,
    baseRef: options.baseCommit,
  });
  const commands = createNodeCommandRunner(options.clock);
  const gates = assembleGates(await detectProject(probe.readCurrent), options.gateOptions ?? {});

  // The queue's declared set is the union of the workers'. A worker that strayed outside its
  // own set already failed its own file-set gate and never reached here.
  const declared = [...new Set(options.candidates.flatMap((one) => one.declaredFiles))];
  if (declared.length > 0) {
    await options.fileSet.declare(declared, "harness");
  }

  const trackedTestFiles = new Set<string>();
  const context = async (): Promise<GateContext> => ({
    workspaceRoot: options.integrationPath,
    changes: await probe.changes(),
    fileSet: options.fileSet.state(),
    budgets: defaultDiffBudget,
    probe,
  });

  const snapshot = async (forContext: GateContext, cycle: GateCycle): Promise<MeasureSnapshot> => {
    for (const file of forContext.changes.files) {
      if (isTestFile(file.path)) {
        trackedTestFiles.add(file.path);
      }
    }
    return takeMeasureSnapshot({
      changes: forContext.changes,
      probe: forContext.probe,
      trackedTestFiles,
      gateMeasures: cycle.measures,
      gateOutputs: cycle.runs.map((run) => run.observation),
    });
  };

  const baseContext = await context();
  const baseCycle = await runGateCycle(gates, baseContext, 0, {
    commands,
    evidence: options.evidence,
    emit: options.emit,
  });
  let baseline = await snapshot(baseContext, baseCycle);
  let baselineGates = baseCycle.statuses;
  let accepted = options.baseCommit;

  const landings: QueueLanding[] = [];

  for (const [index, candidate] of options.candidates.entries()) {
    const landing = await tryCandidate({
      candidate,
      position: index + 1,
      gates,
      commands,
      context,
      snapshot,
      baseline,
      baselineGates,
      accepted,
      options,
    });
    landings.push(landing.landing);

    if (landing.landing.landed) {
      baseline = landing.measures ?? baseline;
      baselineGates = landing.landing.cycle?.statuses ?? baselineGates;
      accepted = landing.landing.commit ?? accepted;
    }
  }

  return {
    baseCommit: options.baseCommit,
    headCommit: await headCommit(options.integrationPath),
    landings,
    baseCycle,
  };
}

interface CandidateAttempt {
  readonly candidate: QueueCandidate;
  readonly position: number;
  readonly gates: readonly GateDefinition[];
  readonly commands: ReturnType<typeof createNodeCommandRunner>;
  readonly context: () => Promise<GateContext>;
  readonly snapshot: (context: GateContext, cycle: GateCycle) => Promise<MeasureSnapshot>;
  readonly baseline: MeasureSnapshot;
  readonly baselineGates: Readonly<Record<string, GateStatus>>;
  readonly accepted: string;
  readonly options: MergeQueueOptions;
}

async function tryCandidate(
  attempt: CandidateAttempt,
): Promise<{ landing: QueueLanding; measures: MeasureSnapshot | null }> {
  const { candidate, options } = attempt;

  const merge = await mergeBranch(
    options.integrationPath,
    candidate.branch,
    `land ${candidate.workerId}: ${candidate.task}`,
  );

  if (!merge.merged) {
    return {
      measures: null,
      landing: await recordAttempt(attempt, {
        landed: false,
        reason: "merge-conflict",
        feedback:
          `Your branch could not be merged into the integration branch.\n` +
          `Conflicting file(s): ${merge.conflictingPaths.join(", ") || "unknown"}\n\n` +
          `${merge.output}\n\n` +
          "Another worker landed a change to the same lines first. Redo the work against the " +
          "integration branch as it now stands.",
        commit: null,
        cycle: null,
        decision: null,
        conflictingPaths: merge.conflictingPaths,
      }),
    };
  }

  const candidateContext = await attempt.context();
  const cycle = await runGateCycle(attempt.gates, candidateContext, attempt.position, {
    commands: attempt.commands,
    evidence: options.evidence,
    emit: options.emit,
  });
  const measures = await attempt.snapshot(candidateContext, cycle);

  if (!isGreen(cycle)) {
    await resetHard(options.integrationPath, attempt.accepted);
    return {
      measures: null,
      landing: await recordAttempt(attempt, {
        landed: false,
        reason: "gates",
        feedback:
          "Your branch merged cleanly and then failed the gates on the integrated tree.\n\n" +
          describeFailuresForModel(cycle),
        commit: null,
        cycle,
        decision: null,
        conflictingPaths: [],
      }),
    };
  }

  // No escape hatch here. Its purpose is to tell a new specification apart from a weakened
  // test, and a merge that lowers the integrated tree's numbers is neither: the worker's own
  // gates already judged its tests against its own base.
  const decision = judgeRatchet({
    baselineGates: attempt.baselineGates,
    candidateGates: cycle.statuses,
    baseline: attempt.baseline,
    candidate: measures,
    exemptFiles: new Set(),
  });

  if (!decision.accepted) {
    await resetHard(options.integrationPath, attempt.accepted);
    return {
      measures: null,
      landing: await recordAttempt(attempt, {
        landed: false,
        reason: "ratchet",
        feedback:
          "Your branch merged cleanly and the gates went green, but it took the integrated " +
          `tree backwards: ${decision.detail}\n\n` +
          describeFailuresForModel(cycle),
        commit: null,
        cycle,
        decision,
        conflictingPaths: [],
      }),
    };
  }

  return {
    measures,
    landing: await recordAttempt(attempt, {
      landed: true,
      reason: null,
      feedback: "",
      commit: merge.commit,
      cycle,
      decision,
      conflictingPaths: [],
    }),
  };
}

interface AttemptOutcome {
  readonly landed: boolean;
  readonly reason: RejectionReason | null;
  readonly feedback: string;
  readonly commit: string | null;
  readonly cycle: GateCycle | null;
  readonly decision: RatchetDecision | null;
  readonly conflictingPaths: readonly string[];
}

/**
 * Recorded twice on purpose: once on the coordinator's chain, which is the queue's own
 * account, and once on the worker's, so the reason its work did not land travels in that
 * worker's bundle rather than only in the report on someone's screen.
 */
async function recordAttempt(
  attempt: CandidateAttempt,
  outcome: AttemptOutcome,
): Promise<QueueLanding> {
  const payload = mergeAttemptSchema.parse({
    workerId: attempt.candidate.workerId,
    branch: attempt.candidate.branch,
    position: attempt.position,
    landed: outcome.landed,
    reason: outcome.reason,
    detail: outcome.landed
      ? `${attempt.candidate.workerId} landed at ${outcome.commit}`
      : outcome.feedback,
    commit: outcome.commit,
    conflictingPaths: [...outcome.conflictingPaths],
    gateRecords: outcome.cycle?.runs.map((run) => run.record) ?? [],
    blockingFailures: outcome.cycle?.blockingFailures.map((run) => run.gateId) ?? [],
    ratchetAccepted: outcome.decision?.accepted ?? null,
    ratchetDetail: outcome.decision?.detail ?? null,
  });

  const recorded = await attempt.options.evidence.record({
    type: "merge-attempt",
    actor: "harness",
    provenance: ["tool-output"],
    payload,
  });

  if (attempt.candidate.evidence !== attempt.options.evidence) {
    await attempt.candidate.evidence.record({
      type: "merge-attempt",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
  }

  return {
    workerId: attempt.candidate.workerId,
    branch: attempt.candidate.branch,
    landed: outcome.landed,
    reason: outcome.reason,
    feedback: outcome.feedback,
    commit: outcome.commit,
    cycle: outcome.cycle,
    decision: outcome.decision,
    record: recorded.record.payloadDigest,
  };
}
