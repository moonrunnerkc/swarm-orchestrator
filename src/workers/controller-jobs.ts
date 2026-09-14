import { join } from "node:path";
import { runAgentTask } from "../agent-run.ts";
import { asJsonValue } from "../evidence/canonical-json.ts";
import { LedgerSealedError, LedgerWriteFailedError } from "../evidence/ledger.ts";
import type { TaskContract } from "../evidence/task-contract.ts";
import { createFileSetRegistry } from "../gates/file-set.ts";
import { emptyMeasureSnapshot } from "../gates/measure-snapshot.ts";
import { summarizeRatchet } from "../gates/ratchet-summary.ts";
import { withControllerCleanup } from "./controller-cleanup.ts";
import {
  appendControllerRecord,
  candidateSchema,
  recordTransition,
  replayController,
} from "./controller-state.ts";
import { createCoordinationTools } from "./coordination.ts";
import type { PlannedAttempt } from "./fan-out.ts";
import { goalRepairFeedback } from "./goal-repair.ts";
import type { ParallelRunOptions, WorkerResult } from "./parallel-run.ts";
import { peersFor, type TrailPeer } from "./trail.ts";
import { createReadTrailTool } from "./trail-tool.ts";
import { addWorktree, type Worktree } from "./worktree.ts";
export async function runOneWorker(
  planned: PlannedAttempt,
  baseCommit: string,
  /** The commit the whole run branched from, which every worker's gates are read from. */
  criteriaRef: string,
  options: ParallelRunOptions,
  registered: TrailPeer[],
  contract?: TaskContract,
  repairFeedback?: string,
  graphRevision = "initial",
): Promise<WorkerResult> {
  const { workerId, task, taskId, attemptIndex } = planned;
  const evidence = await options.createWorkerSession(workerId);
  registered.push({ workerId, taskId, chain: evidence });
  const branch = `swarm/${options.runId}/${workerId}`;
  let worktree: Worktree | null = null;
  let preserveWorktree = false;
  const path = join(options.scratchRoot, workerId);
  await recordTransition(options.coordinator, {
    kind: "dispatch-intent",
    taskId,
    workerId,
    sessionId: evidence.sessionId,
    sessionDirectory: evidence.directory,
    branch,
    path,
    baseCommit,
    graphRevision,
    attemptIndex,
  });
  const finish = async (worker: WorkerResult): Promise<WorkerResult> => {
    const { evidence: workerEvidence, ...snapshot } = worker;
    await appendControllerRecord(
      options.coordinator,
      "controller-candidate",
      asJsonValue(
        candidateSchema.parse({
          ...snapshot,
          sessionId: workerEvidence.sessionId,
          chainHead: workerEvidence.head().hash,
        }),
      ),
    );
    return worker;
  };

  await options.coordinator.record({
    type: "worker-started",
    actor: "harness",
    provenance: ["user"],
    payload: {
      workerId,
      taskId,
      attemptIndex,
      sessionId: evidence.sessionId,
      task,
      branch,
      baseCommit,
      graphRevision,
    },
  });

  try {
    options.abortSignal.throwIfAborted();
    worktree = await addWorktree({
      repositoryRoot: options.repositoryRoot,
      path: join(options.scratchRoot, workerId),
      branch,
      baseRef: baseCommit,
    });

    await recordTransition(options.coordinator, {
      kind: "worktree-created",
      workerId,
      path,
      branch,
      baseCommit,
    });
    const fileSet = createFileSetRegistry(evidence);
    const remainingWall = options.remainingWallMs?.() ?? null;
    const feedback = repairFeedback ?? goalRepairFeedback(options.coordinator, taskId);
    const result = await runAgentTask({
      ...(contract === undefined ? {} : { contract }),
      ...(feedback === undefined ? {} : { repairFeedback: feedback }),
      task,
      coordination:
        options.peerInformation === false ||
        (options.goalContract !== undefined && options.redundancy > 1)
          ? []
          : createCoordinationTools({
              workerId,
              taskId,
              baseCommit,
              graphRevision,
              evidence,
              peers: () => registered,
              board: () => replayController(options.coordinator).graph,
            }),
      workspace: worktree.path,
      baseRef: baseCommit,
      criteriaRef,
      maxSteps: options.maxSteps,
      attempts: options.attempts,
      model:
        options.runContext?.model(workerId, options.createModel(workerId, evidence)) ??
        options.createModel(workerId, evidence),
      commandPool: options.runContext?.tests,
      ...(options.runStorePath === undefined ? {} : { runStorePath: options.runStorePath }),
      evidence,
      fileSet,
      clock: options.clock,
      random: options.random,
      emit: (event) => {
        options.emit(workerId, event);
      },
      // A worker is unattended, so a call that needs a human is refused and recorded.
      confirm: () => Promise.resolve(false),
      abortSignal: options.abortSignal,
      ...(options.isolation === undefined ? {} : { isolation: options.isolation(worktree.path) }),
      // The remainder rather than a fresh budget: a worker starting late gets what is left.
      ...(remainingWall === null ? {} : { maxWallTimeMs: remainingWall }),
      homeDir: options.scratchRoot,
      ...(options.peerInformation === false ||
      (options.goalContract !== undefined && options.redundancy > 1)
        ? {}
        : {
            trail: createReadTrailTool({
              peers: () => peersFor(workerId, taskId, registered),
            }),
          }),
      ...(planned.sampling === null ? {} : { sampling: planned.sampling }),
      ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
    });

    // Rejected patches remain reachable for repair. Only green candidates enter integration.
    const writtenCommit = await worktree.commitAll(`${workerId}: ${task}`);
    const commit =
      writtenCommit ??
      (result.green &&
      (options.goalContract !== undefined || (contract?.requiredChecks.length ?? 0) > 0)
        ? baseCommit
        : null);

    const measures = result.gates.outcome.finalMeasures;
    const cycle = result.gates.outcome.finalCycle;

    return await finish({
      baseCommit,
      graphRevision,
      workerId,
      taskId,
      attemptIndex,
      task,
      branch,
      evidence,
      green: result.green,
      commit,
      declaredFiles: [...fileSet.state().allowed].sort(),
      detail: result.green
        ? `gates green after ${result.loop.steps} step(s)`
        : describeRed(cycle.blockingFailures, result.loop.stopReason),
      measures,
      erosions: summarizeRatchet(result.gates.outcome).erosions,
      changedFiles: cycle.measures.changedFiles ?? 0,
      addedLines: cycle.measures.addedLines ?? 0,
    });
  } catch (cause) {
    if (cause instanceof LedgerWriteFailedError || cause instanceof LedgerSealedError) {
      preserveWorktree = true;
      throw cause;
    }
    preserveWorktree = worktree !== null;
    const detail = `the worker did not finish: ${describeCause(cause)}`;
    // On the worker's own chain as well as in the report: a worker that fell over before it
    // recorded anything would otherwise ship an empty bundle that explains nothing.
    await evidence.record({
      type: "session-stopped",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { workerId, task, stopReason: "worker-failed", detail },
    });
    return await finish({
      baseCommit,
      graphRevision,
      workerId,
      taskId,
      attemptIndex,
      task,
      branch,
      evidence,
      green: false,
      commit: null,
      declaredFiles: [],
      detail,
      measures: emptyMeasureSnapshot,
      erosions: 0,
      changedFiles: 0,
      addedLines: 0,
    });
  } finally {
    if (worktree !== null && !preserveWorktree) {
      await recordTransition(options.coordinator, {
        kind: "cleanup-intent",
        workerId,
        path,
        branch,
      });
      const owned = worktree;
      await withControllerCleanup(options.clock, (signal) => owned.remove(signal));
      await recordTransition(options.coordinator, {
        kind: "cleanup-completed",
        workerId,
        path,
        branch,
      });
    }
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function describeRed(blocking: readonly { readonly gateId: string }[], stopReason: string): string {
  if (blocking.length > 0) {
    return `blocking gate(s) failed: ${blocking.map((gate) => gate.gateId).join(", ")}`;
  }
  return `the loop stopped with ${stopReason}`;
}
