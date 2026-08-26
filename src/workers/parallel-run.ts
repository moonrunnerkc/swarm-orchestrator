import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { runAgentTask } from "../agent-run.ts";
import type { Clock } from "../core/clock.ts";
import type { LoopEvent } from "../core/loop-events.ts";
import type { ModelClient } from "../core/model-client.ts";
import type { RandomSource } from "../core/random-source.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { GateSetOptions } from "../gates/default-gates.ts";
import { createFileSetRegistry } from "../gates/file-set.ts";
import { emptyMeasureSnapshot, type MeasureSnapshot } from "../gates/measure-snapshot.ts";
import { summarizeRatchet } from "../gates/ratchet-summary.ts";
import { type Attempt, type AttemptSelection, selectAttempt } from "./attempt-selector.ts";
import { type PlannedAttempt, planAttempts } from "./fan-out.ts";
import { claimGraphOutcome, declareTaskGraph, type NodeOutcome } from "./graph-record.ts";
import {
  type MergeQueueResult,
  type QueueCandidate,
  type QueueLanding,
  runMergeQueue,
} from "./merge-queue.ts";
import { createWorkPool } from "./pool.ts";
import { blockedBy, scheduleLayers } from "./schedule.ts";
import { recordSelection } from "./selection-record.ts";
import type { TaskGraph } from "./task-graph.ts";
import { peersFor, type TrailPeer } from "./trail.ts";
import { createReadTrailTool } from "./trail-tool.ts";
import { addWorktree, sweepRunBranches, type Worktree } from "./worktree.ts";

const runProcess = promisify(execFile);

interface ParallelRunOptions {
  readonly repositoryRoot: string;
  readonly baseRef: string;
  /** One task per worker, in the order they will be queued. */
  readonly tasks: readonly string[];
  /** Names the branches and worktrees this run creates, so two runs never collide. */
  readonly runId: string;
  /** Where the worktrees go. Outside the repository, so they are never a change to it. */
  readonly scratchRoot: string;
  readonly coordinator: EvidenceRecorder;
  readonly createWorkerSession: (workerId: string) => Promise<EvidenceRecorder>;
  readonly createModel: (workerId: string, evidence: EvidenceRecorder) => ModelClient;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly emit: (workerId: string, event: LoopEvent) => void;
  readonly maxSteps: number;
  readonly attempts: number;
  /** How many ways each task is tried. One is the run this had before any of it. */
  readonly redundancy: number;
  /** How many workers may hold a worktree at once. Zero or less is no cap. */
  readonly concurrency: number;
  /** Names the seeds that make attempts at one task diverge, so a report can re-derive them. */
  readonly modelSpec: string;
  /**
   * The declared decomposition, where there is one. Its nodes replace the flat task list and
   * are landed layer by layer, each layer branching from the tree the one before it left.
   */
  readonly graph?: TaskGraph;
  readonly graphSource?: "goal" | "file";
  readonly gateOptions?: GateSetOptions;
  readonly abortSignal: AbortSignal;
}

export interface WorkerResult {
  readonly workerId: string;
  /** Which task this worker was one attempt at, and which attempt it was. */
  readonly taskId: string;
  readonly attemptIndex: number;
  readonly task: string;
  readonly branch: string;
  readonly evidence: EvidenceRecorder;
  /** The worker's own gates went green in its own worktree. Not a statement about landing. */
  readonly green: boolean;
  readonly commit: string | null;
  readonly declaredFiles: readonly string[];
  readonly detail: string;
  /** The numbers as they stood in this worktree, which is what a selection reads. */
  readonly measures: MeasureSnapshot;
  readonly erosions: number;
  readonly changedFiles: number;
  readonly addedLines: number;
}

export interface ParallelRunResult {
  readonly workers: readonly WorkerResult[];
  /** One per task, empty where each task was tried once and there was nothing to choose. */
  readonly selections: readonly AttemptSelection[];
  /** Null when no worker produced anything for the queue to arbitrate. */
  readonly queue: MergeQueueResult | null;
  readonly integrationBranch: string;
  /** Worker branches removed once the queue was done with them. */
  readonly sweptBranches: readonly string[];
  readonly baseCommit: string;
  readonly headCommit: string;
}

/**
 * N workers, each an ordinary run in a worktree of its own, then one queue that lands them.
 *
 * Nothing here touches the repository the user is sitting in. Worktrees are checked out
 * elsewhere, the queue integrates onto a branch of its own, and where that branch goes next
 * is left to the human: a run that moved someone's checked-out branch under them would be a
 * worse failure than any merge conflict.
 */
export async function runInParallel(options: ParallelRunOptions): Promise<ParallelRunResult> {
  const baseCommit = (
    await runProcess("git", ["rev-parse", options.baseRef], { cwd: options.repositoryRoot })
  ).stdout.trim();

  // Every worker registers its chain here as it starts, and reads the others live. This is
  // the whole coordination medium: no bus, no shared state a worker can write through, just
  // the ledgers they were each already writing (invariant 11 untouched, these are reads).
  const registered: TrailPeer[] = [];
  // The slot covers the whole worktree lifetime rather than the agent loop alone: several
  // attempts per task multiplies the concurrent `git worktree add` calls against one
  // repository, which is the contention the cap exists for.
  const pool = createWorkPool(options.concurrency);

  const graph = options.graph ?? null;
  if (graph !== null) {
    await declareTaskGraph(options.coordinator, graph, options.graphSource ?? "file");
  }
  // A run without a graph is a run with one layer holding every task, so both paths are the
  // same loop and the ordinary run reaches the queue exactly once, as it always did. A graph's
  // layers carry their node ids, which is what a blocked node is named by.
  const layers: readonly { ids: readonly string[]; tasks: readonly string[] }[] =
    graph === null ? [{ ids: [], tasks: options.tasks }] : layersOf(graph);

  const integration = await addWorktree({
    repositoryRoot: options.repositoryRoot,
    path: join(options.scratchRoot, "integration"),
    branch: `swarm/${options.runId}/integration`,
    baseRef: baseCommit,
  });

  const workers: WorkerResult[] = [];
  const selections: AttemptSelection[] = [];
  const landings: QueueLanding[] = [];
  const landedTasks = new Set<string>();
  let queue: MergeQueueResult | null = null;
  let head = baseCommit;
  let tasksPlanned = 0;
  const notLanded = new Set<string>();
  const nodeOfTask = new Map<string, string>();
  // One registry across every layer: the first declares, the rest amend, because the union
  // of what the workers touched is not known until the last layer has run.
  const fileSet = createFileSetRegistry(options.coordinator);

  async function landLayer(proposals: readonly RankedProposal[]): Promise<void> {
    const landed = await runMergeQueue({
      integrationPath: integration.path,
      // Each layer is ratcheted against the tree the layer before it left, which is also
      // the tree its workers branched from. A dependent node has to see its parent's work.
      baseCommit: head,
      candidates: proposals.map((proposal) => ({
        ...asCandidate(proposal.winner),
        alternates: proposal.alternates.map(asCandidate),
      })),
      evidence: options.coordinator,
      fileSet,
      clock: options.clock,
      emit: (event) => {
        options.emit("queue", event);
      },
      ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
    });

    landings.push(...landed.landings);
    head = landed.headCommit;
    queue = { ...landed, baseCommit, headCommit: head, landings };
    for (const landing of landed.landings.filter((one) => one.landed)) {
      const worker = workers.find((one) => one.workerId === landing.workerId);
      if (worker !== undefined) {
        landedTasks.add(worker.taskId);
      }
    }
  }

  try {
    for (const layer of layers) {
      const blocked = graph === null ? new Set<string>() : new Set(blockedBy(graph, notLanded));
      const runnable = layer.ids
        .map((id, index) => ({ id, task: layer.tasks[index] ?? "" }))
        .filter((one) => !blocked.has(one.id));
      const tasks = graph === null ? layer.tasks : runnable.map((one) => one.task);
      if (tasks.length === 0) {
        continue;
      }
      const planned = planAttempts(tasks, options.redundancy, options.modelSpec, {
        tasks: tasksPlanned,
        workers: workers.length,
      });
      tasksPlanned += tasks.length;
      const ran = await Promise.all(
        planned.map((attempt) => pool.run(() => runOneWorker(attempt, head, options, registered))),
      );
      workers.push(...ran);
      // taskIds come out of the planner in task order, so zipping them with the layer's
      // runnable node ids is exact rather than a match on the brief text, which two nodes
      // could legitimately share.
      const taskIds = [...new Set(planned.map((one) => one.taskId))];
      for (const [index, taskId] of taskIds.entries()) {
        const nodeId = runnable[index]?.id;
        if (nodeId !== undefined) {
          nodeOfTask.set(taskId, nodeId);
        }
      }

      const chosen = await chooseProposals(ran, head, options);
      selections.push(...chosen.selections);

      if (chosen.proposals.length > 0) {
        await landLayer(chosen.proposals);
      }

      // Always, including where the layer proposed nothing at all: a node whose attempts all
      // finished red did not land either, and its dependents must not run against a tree
      // that lacks it. Skipping this on the empty path is what let a blocked node run.
      for (const taskId of taskIds) {
        const nodeId = nodeOfTask.get(taskId);
        if (nodeId !== undefined && !landedTasks.has(taskId)) {
          notLanded.add(nodeId);
        }
      }
    }
  } finally {
    await integration.remove();
  }

  // The queue is finished with the worker branches now, so they go. They outlive their
  // worktrees on purpose, and nothing used to outlive them.
  const sweptBranches = await sweepRunBranches(options.repositoryRoot, options.runId);

  await claimTheChosenLanded(selections, queue, options.coordinator);
  if (graph !== null) {
    await claimGraphOutcome(
      options.coordinator,
      graph,
      nodeOutcomes(graph, workers, landings, nodeOfTask),
    );
  }

  // Recorded last, after the queue has had its say, because a rejection is appended to the
  // worker's own chain and that moves its head. The bundle's linkage has to name the head as
  // it finally stands.
  for (const worker of workers) {
    await options.coordinator.record({
      type: "worker-finished",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        workerId: worker.workerId,
        sessionId: worker.evidence.sessionId,
        task: worker.task,
        branch: worker.branch,
        green: worker.green,
        commit: worker.commit,
        declaredFiles: [...worker.declaredFiles],
        detail: worker.detail,
        chainHead: worker.evidence.head().hash,
        recordCount: worker.evidence.head().recordCount,
      },
    });
  }

  return {
    workers,
    selections,
    queue,
    integrationBranch: integration.branch,
    sweptBranches,
    baseCommit,
    headCommit: head,
  };
}

async function claimTheChosenLanded(
  selections: readonly AttemptSelection[],
  queue: MergeQueueResult | null,
  coordinator: EvidenceRecorder,
): Promise<void> {
  for (const selection of selections) {
    const winner = selection.winner;
    const landing = queue?.landings.find((one) => one.workerId === winner);
    if (winner === null || landing === undefined) {
      continue;
    }
    await coordinator.submitClaim(
      {
        predicate: `landed == true && workerId == "${winner}"`,
        record: landing.record,
        recordKind: "merge-attempt",
        narrative:
          `${selection.taskId} ranked ${selection.attempts.length} attempt(s) and chose ` +
          `${winner}${selection.decidedBy === null ? "" : ` on ${selection.decidedBy}`}.`,
      },
      "harness",
    );
  }
}

function asCandidate(worker: WorkerResult): QueueCandidate {
  return {
    workerId: worker.workerId,
    branch: worker.branch,
    task: worker.task,
    declaredFiles: worker.declaredFiles,
    evidence: worker.evidence,
  };
}

/**
 * One proposal per task, and the record of why it was that one.
 *
 * Where a task was tried once there is nothing to choose, so nothing is chosen and nothing
 * is written: that run reaches the queue exactly as it did before any of this existed. Where
 * it was tried several ways, the comparator reads the numbers each attempt left in its own
 * worktree and the working goes on the coordinator's chain, losers included, with the reason
 * each one was left out.
 */
async function chooseProposals(
  workers: readonly WorkerResult[],
  baseCommit: string,
  options: ParallelRunOptions,
): Promise<{ proposals: readonly RankedProposal[]; selections: readonly AttemptSelection[] }> {
  if (options.redundancy <= 1) {
    return {
      proposals: workers
        .filter((worker) => worker.commit !== null)
        .map((winner) => ({ winner, alternates: [] })),
      selections: [],
    };
  }

  const byTask = new Map<string, WorkerResult[]>();
  for (const worker of workers) {
    const attempts = byTask.get(worker.taskId) ?? [];
    attempts.push(worker);
    byTask.set(worker.taskId, attempts);
  }

  const proposals: RankedProposal[] = [];
  const selections: AttemptSelection[] = [];

  for (const [taskId, attempts] of byTask) {
    const selection = selectAttempt(
      taskId,
      attempts.map((attempt) => asAttempt(attempt, baseCommit)),
    );
    await recordSelection(options.coordinator, selection);
    selections.push(selection);

    // In rank order, so the queue's fallback is the attempt the comparator put next.
    const ranked = selection.order
      .map((workerId) => attempts.find((attempt) => attempt.workerId === workerId))
      .filter((attempt): attempt is WorkerResult => attempt !== undefined);
    const [winner, ...alternates] = ranked;
    if (winner !== undefined) {
      proposals.push({ winner, alternates });
    }
  }

  return { proposals, selections };
}

/** The attempt a task is proposing, with the ones the comparator ranked behind it. */
interface RankedProposal {
  readonly winner: WorkerResult;
  readonly alternates: readonly WorkerResult[];
}

function asAttempt(worker: WorkerResult, baseCommit: string): Attempt {
  return {
    workerId: worker.workerId,
    taskId: worker.taskId,
    attemptIndex: worker.attemptIndex,
    green: worker.green,
    commit: worker.commit,
    baseCommit,
    measures: worker.measures,
    erosions: worker.erosions,
    changedFiles: worker.changedFiles,
    addedLines: worker.addedLines,
  };
}

async function runOneWorker(
  planned: PlannedAttempt,
  baseCommit: string,
  options: ParallelRunOptions,
  registered: TrailPeer[],
): Promise<WorkerResult> {
  const { workerId, task, taskId, attemptIndex } = planned;
  const evidence = await options.createWorkerSession(workerId);
  registered.push({ workerId, taskId, chain: evidence });
  const branch = `swarm/${options.runId}/${workerId}`;
  let worktree: Worktree | null = null;

  await options.coordinator.record({
    type: "worker-started",
    actor: "harness",
    provenance: ["user"],
    payload: {
      workerId,
      sessionId: evidence.sessionId,
      task,
      branch,
      baseCommit,
    },
  });

  try {
    worktree = await addWorktree({
      repositoryRoot: options.repositoryRoot,
      path: join(options.scratchRoot, workerId),
      branch,
      baseRef: baseCommit,
    });

    const fileSet = createFileSetRegistry(evidence);
    const result = await runAgentTask({
      task,
      workspace: worktree.path,
      baseRef: baseCommit,
      maxSteps: options.maxSteps,
      attempts: options.attempts,
      model: options.createModel(workerId, evidence),
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
      homeDir: options.scratchRoot,
      trail: createReadTrailTool({
        peers: () => peersFor(workerId, taskId, registered),
      }),
      ...(planned.sampling === null ? {} : { sampling: planned.sampling }),
      ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
    });

    // Only green work is offered to the queue. A worker whose own gates are red has nothing
    // worth arbitrating, and letting it propose would spend a full integration gate run
    // discovering what its own gates already said.
    const commit = result.green ? await worktree.commitAll(`${workerId}: ${task}`) : null;

    const measures = result.gates.outcome.finalMeasures;
    const cycle = result.gates.outcome.finalCycle;

    return {
      workerId,
      taskId,
      attemptIndex,
      task,
      branch,
      evidence,
      green: result.green,
      commit,
      declaredFiles: fileSet.state().declared,
      detail: result.green
        ? `gates green after ${result.loop.steps} step(s)`
        : describeRed(cycle.blockingFailures, result.loop.stopReason),
      measures,
      erosions: summarizeRatchet(result.gates.outcome).erosions,
      changedFiles: cycle.measures.changedFiles ?? 0,
      addedLines: cycle.measures.addedLines ?? 0,
    };
  } catch (cause) {
    const detail = `the worker did not finish: ${describeCause(cause)}`;
    // On the worker's own chain as well as in the report: a worker that fell over before it
    // recorded anything would otherwise ship an empty bundle that explains nothing.
    await evidence.record({
      type: "session-stopped",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { workerId, task, stopReason: "worker-failed", detail },
    });
    return {
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
    };
  } finally {
    await worktree?.remove();
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

/** Each layer as its node ids and the briefs those nodes hand their workers. */
function layersOf(
  graph: TaskGraph,
): readonly { ids: readonly string[]; tasks: readonly string[] }[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return scheduleLayers(graph).map((ids) => ({
    ids,
    tasks: ids.map((id) => byId.get(id)?.instruction ?? ""),
  }));
}

/**
 * What became of each declared node. A node whose layer never ran, because a parent did not
 * land, is blocked rather than failed: it was never attempted, and reporting it as an
 * attempt that produced nothing would be a different and untrue statement.
 */
function nodeOutcomes(
  graph: TaskGraph,
  workers: readonly WorkerResult[],
  landings: readonly QueueLanding[],
  nodeOfTask: ReadonlyMap<string, string>,
): readonly NodeOutcome[] {
  const landedWorkers = new Map(
    landings.filter((one) => one.landed).map((one) => [one.workerId, one]),
  );
  const workersByNode = new Map<string, WorkerResult[]>();
  for (const worker of workers) {
    const nodeId = nodeOfTask.get(worker.taskId);
    if (nodeId === undefined) {
      continue;
    }
    workersByNode.set(nodeId, [...(workersByNode.get(nodeId) ?? []), worker]);
  }

  return graph.nodes.map((node) => {
    const attempts = workersByNode.get(node.id) ?? [];
    const landed = attempts.find((worker) => landedWorkers.has(worker.workerId));
    return {
      id: node.id,
      workerId: landed?.workerId ?? attempts[0]?.workerId ?? null,
      landed: landed !== undefined,
      commit: landed === undefined ? null : (landedWorkers.get(landed.workerId)?.commit ?? null),
      blocked: attempts.length === 0,
    };
  });
}
