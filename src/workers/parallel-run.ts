import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Clock } from "../core/clock.ts";
import type { LoopEvent } from "../core/loop-events.ts";
import type { ModelClient } from "../core/model-client.ts";
import type { RandomSource } from "../core/random-source.ts";
import { asJsonValue } from "../evidence/canonical-json.ts";
import {
  declareGoalContract,
  type GoalContract,
  goalImmutablePaths,
} from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { parseTaskContract } from "../evidence/task-contract.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import type { IsolationBackend } from "../exec/execution-mode.ts";
import type { GateSetOptions } from "../gates/default-gates.ts";
import { createFileSetRegistry } from "../gates/file-set.ts";
import {
  type IndependentVerification,
  verifyIndependently,
} from "../gates/independent-verification.ts";
import type { MeasureSnapshot } from "../gates/measure-snapshot.ts";
import { createNodeCommandRunner } from "../gates/node-command-runner.ts";
import { type Attempt, type AttemptSelection, selectAttempt } from "./attempt-selector.ts";
import { recordControllerEvent } from "./controller-events.ts";
import { runControllerSchedule } from "./controller-scheduler.ts";
import { recordTransition, replayController } from "./controller-state.ts";
import { planAttempts } from "./fan-out.ts";
import { assessController, type ControllerOutcome } from "./goal-outcome.ts";
import { claimGraphOutcome, declareTaskGraph, type NodeOutcome } from "./graph-record.ts";
import { initialControllerGraph, recordControllerGraph } from "./graph-revision.ts";
import {
  type MergeQueueResult,
  type QueueCandidate,
  type QueueLanding,
  runMergeQueue,
} from "./merge-queue.ts";
import { createRunContext, type RunContext } from "./run-context.ts";
import { scheduleLayers } from "./schedule.ts";
import { recordSelection } from "./selection-record.ts";
import { contractsFromGraph, declareTaskContracts, type TaskContract } from "./task-contract.ts";
import type { TaskGraph } from "./task-graph.ts";
import type { TrailPeer } from "./trail.ts";
import { addWorktree, sweepRunBranches } from "./worktree.ts";

const runProcess = promisify(execFile);

/** What a node's contract records where the run named no wall budget of its own. */
const defaultNodeWallMs = 30 * 60 * 1000;

export interface ParallelRunOptions {
  readonly adaptation?: boolean;
  readonly peerInformation?: boolean;
  readonly graphRevisionLimit?: number;
  readonly revisions?: readonly import("./controller-revisions.ts").RevisionRequest[];
  readonly goalContract?: GoalContract;
  readonly runContext?: RunContext;
  readonly repairAttempts?: number;
  readonly modelConcurrency?: number;
  readonly testConcurrency?: number;
  readonly runStorePath?: string;
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
  readonly contracts?: readonly TaskContract[];
  readonly immutablePaths?: readonly string[];
  readonly requiredChecks?: readonly string[];
  readonly maxTokens?: number;
  readonly gateOptions?: GateSetOptions;
  readonly abortSignal: AbortSignal;
  /**
   * What is left of the whole run's wall budget, asked each time a worker starts. A budget each
   * worker applies to itself is not a budget for the run: ten workers with half an hour each is
   * five hours. Null where the run was given no budget.
   */
  readonly remainingWallMs?: () => number | null;
  /**
   * Where a worker's commands run, given its worktree. One backend per worktree rather than one
   * shared over the repository: a shared mount would let every worker reach every other
   * worker's tree, which is what worktrees exist to prevent.
   */
  readonly isolation?: (worktreePath: string) => IsolationBackend;
}

export interface WorkerResult {
  readonly baseCommit: string;
  readonly graphRevision: string;
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
  readonly outcome: ControllerOutcome;
  readonly verification: IndependentVerification | null;
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
export async function runInParallel(input: ParallelRunOptions): Promise<ParallelRunResult> {
  const context =
    input.runContext ??
    (await createRunContext({
      evidence: input.coordinator,
      clock: input.clock,
      runId: input.runId,
      maxTokens: input.maxTokens ?? 200_000,
      maxWallMs: input.remainingWallMs?.() ?? defaultNodeWallMs,
      modelConcurrency: input.modelConcurrency ?? 1,
      testConcurrency: input.testConcurrency ?? 1,
      signal: input.abortSignal,
    }));
  try {
    const goalContract =
      input.goalContract === undefined
        ? undefined
        : await declareGoalContract(input.coordinator, input.goalContract);
    return await executeParallel({
      ...input,
      immutablePaths: [
        ...(input.immutablePaths ?? []),
        ...(goalContract === undefined ? [] : goalImmutablePaths(goalContract)),
      ],
      runContext: context,
      abortSignal: context.signal,
      remainingWallMs: () =>
        Math.min(context.remainingWallMs(), input.remainingWallMs?.() ?? Infinity),
    });
  } finally {
    if (input.runContext === undefined) context.dispose();
  }
}

async function executeParallel(options: ParallelRunOptions): Promise<ParallelRunResult> {
  if (
    !Number.isInteger(options.repairAttempts ?? 2) ||
    (options.repairAttempts ?? 2) < 0 ||
    (options.repairAttempts ?? 2) > 8
  )
    throw new Error("repairAttempts must be an integer from 0 through 8");
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

  const graph = options.graph ?? null;
  const contracts =
    graph === null
      ? options.tasks.map((objective, index) =>
          parseTaskContract({
            version: 3,
            taskId: `task-${index + 1}`,
            objective,
            dependsOn: [],
            scopeKind: "workspace",
            allowedPaths: ["**"],
            immutablePaths: options.immutablePaths ?? [],
            allowedTools: [
              "read",
              "write",
              "edit",
              "list",
              "search",
              "shell",
              "trail",
              "coordination",
            ],
            network: options.isolation === undefined ? "unrestricted" : "denied",
            execution: options.isolation === undefined ? "restricted" : "isolated",
            requiredChecks: options.requiredChecks ?? [],
            budget: {
              maxSteps: options.maxSteps,
              maxWallMs: Math.max(1, options.remainingWallMs?.() ?? defaultNodeWallMs),
              maxTokens: options.maxTokens ?? 200_000,
            },
            riskTier: "medium",
            scopeAuthority: "human",
          }),
        )
      : contractsFromGraph(graph, {
          maxSteps: options.maxSteps,
          maxWallMs: Math.max(1, options.remainingWallMs?.() ?? defaultNodeWallMs),
          immutablePaths: options.immutablePaths ?? [],
          requiredChecks: options.requiredChecks ?? [],
          maxTokens: options.maxTokens ?? 200_000,
          network: options.isolation === undefined ? "unrestricted" : "denied",
          execution: options.isolation === undefined ? "restricted" : "isolated",
          allowedTools: [
            "read",
            "write",
            "edit",
            "list",
            "search",
            "shell",
            "trail",
            "coordination",
          ],
        });
  const effectiveContracts = options.contracts ?? contracts;
  if (graph !== null) {
    for (const contract of effectiveContracts) {
      const node = graph.nodes.find((node) => node.id === contract.taskId);
      if (
        node === undefined ||
        contract.objective !== node.instruction ||
        contract.allowedPaths.some((path) => !node.files.includes(path)) ||
        node.acceptance.some((id) => !contract.requiredChecks.includes(id)) ||
        node.dependsOn.length !== contract.dependsOn.length ||
        node.dependsOn.some((id) => !contract.dependsOn.includes(id)) ||
        (options.immutablePaths ?? []).some((path) => !contract.immutablePaths.includes(path)) ||
        (options.requiredChecks ?? []).some((id) => !contract.requiredChecks.includes(id))
      ) {
        throw new Error(
          `contract ${contract.taskId} does not preserve its graph scope and acceptance`,
        );
      }
    }
    if (
      effectiveContracts.length !== graph.nodes.length ||
      new Set(effectiveContracts.map((contract) => contract.taskId)).size !== graph.nodes.length
    ) {
      throw new Error("every graph node requires exactly one effective contract");
    }
    await declareTaskGraph(options.coordinator, graph, options.graphSource ?? "file");
  }
  await declareTaskContracts(options.coordinator, effectiveContracts, baseCommit);
  // A run without a graph is a run with one layer holding every task, so both paths are the
  // same loop and the ordinary run reaches the queue exactly once, as it always did. A graph's
  // layers carry their node ids, which is what a blocked node is named by.
  const layers: readonly { ids: readonly string[]; tasks: readonly string[] }[] =
    graph === null ? [{ ids: [], tasks: options.tasks }] : layersOf(graph);

  const nodeOfTask = new Map<string, string>();
  const orderedNodes =
    graph === null
      ? []
      : layers
          .flatMap((layer) => layer.ids)
          .map((id) => graph.nodes.find((node) => node.id === id))
          .filter((node) => node !== undefined);
  const initialTasks =
    graph === null ? options.tasks : orderedNodes.map((node) => node.instruction);
  const planned = planAttempts(initialTasks, options.redundancy, options.modelSpec);
  const taskIds = [...new Set(planned.map((attempt) => attempt.taskId))];
  for (const [index, taskId] of taskIds.entries()) {
    const node = orderedNodes[index];
    if (node !== undefined) nodeOfTask.set(taskId, node.id);
  }
  const taskOfNode = new Map([...nodeOfTask].map(([taskId, nodeId]) => [nodeId, taskId]));
  const scheduled = taskIds.map((id, index) => ({
    id,
    dependsOn:
      orderedNodes[index]?.dependsOn.map(
        (dependency) => taskOfNode.get(dependency) ?? dependency,
      ) ?? [],
    files: orderedNodes[index]?.files ?? [],
  }));
  const initialNodes = scheduled.map((task) => {
    const contract = effectiveContracts.find(
      (contract) => contract.taskId === (nodeOfTask.get(task.id) ?? task.id),
    );
    if (contract === undefined) throw new Error(`task ${task.id} has no effective contract`);
    return { id: task.id, contract, dependsOn: task.dependsOn, obligations: [task.id] };
  });
  const controllerGraph = initialControllerGraph(
    initialNodes,
    options.goalContract?.requirements.map((requirement) => requirement.id) ?? [],
    options.graphRevisionLimit ?? 4,
  );
  await recordControllerGraph(options.coordinator, controllerGraph);
  await recordControllerEvent(options.coordinator, {
    kind: "work-declared",
    tasks: initialTasks.map((objective, index) => ({ id: `task-${index + 1}`, objective })),
  });
  const integration = await addWorktree({
    repositoryRoot: options.repositoryRoot,
    path: join(options.scratchRoot, "integration"),
    branch: `swarm/${options.runId}/integration`,
    baseRef: baseCommit,
  });

  const workers: WorkerResult[] = [];
  const selections: AttemptSelection[] = [];
  const landings: QueueLanding[] = [];
  let queue: MergeQueueResult | null = null;
  let head = baseCommit;
  // One registry across every layer: the first declares, the rest amend, because the union
  // of what the workers touched is not known until the last layer has run.
  const fileSet = createFileSetRegistry(options.coordinator);

  const integrationEffects = new Map<string, string>();
  let integrationSequence = 0;
  async function landLayer(proposals: readonly RankedProposal[]): Promise<void> {
    const landed = await runMergeQueue({
      integrationPath: integration.path,
      beforeAttempt: async (candidate, accepted) => {
        const worker = workers.find((worker) => worker.workerId === candidate.workerId);
        if (worker?.commit == null) throw new Error("integration candidate has no retained commit");
        const effectId = `integration-${++integrationSequence}`;
        integrationEffects.set(worker.workerId, effectId);
        await recordTransition(options.coordinator, {
          kind: "integration-intent",
          effectId,
          taskId: worker.taskId,
          workerId: worker.workerId,
          baseCommit: accepted,
          graphRevision:
            replayController(options.coordinator).graph?.revision ?? controllerGraph.revision,
          candidateCommit: worker.commit,
          branch: worker.branch,
        });
      },
      afterAttempt: async (landing) => {
        const effectId = integrationEffects.get(landing.workerId);
        if (effectId === undefined) throw new Error("integration completion has no intent");
        await recordTransition(options.coordinator, {
          kind: "integration-completed",
          effectId,
          landed: landing.landed,
          commit: landing.commit,
          observation: landing.record,
        });
      },
      commandPool: options.runContext?.tests,
      abortSignal: options.abortSignal,
      ...(options.isolation === undefined
        ? {}
        : { isolation: options.isolation(integration.path) }),
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
      // The first layer seals the chain's criteria; every later layer runs under that seal,
      // and every layer reads its gate commands from the commit the run branched from.
      criteriaSealed: queue !== null,
      criteriaRef: baseCommit,
      ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
    });

    landings.push(...landed.landings);
    head = landed.headCommit;
    queue = { ...landed, baseCommit, headCommit: head, landings };
  }

  try {
    await runControllerSchedule({
      options,
      criteriaRef: baseCommit,
      planned,
      registered,
      workers,
      head: () => head,
      integrate: async (completed) => {
        const chosen = await chooseProposals(completed, completed[0]?.baseCommit ?? head, options);
        selections.push(...chosen.selections);
        if (chosen.proposals.length > 0) await landLayer(chosen.proposals);
      },
    });
  } finally {
    await integration.remove();
  }

  // The queue is finished with the worker branches now, so they go. They outlive their
  // worktrees on purpose, and nothing used to outlive them.
  const sweptBranches = await sweepRunBranches(
    options.repositoryRoot,
    options.runId,
    workers
      .filter(
        (worker) =>
          worker.commit === null ||
          landings.some((landing) => landing.workerId === worker.workerId && landing.landed),
      )
      .map((worker) => ({ branch: worker.branch, commit: worker.commit ?? worker.baseCommit })),
  );

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
        taskId: worker.taskId,
        attemptIndex: worker.attemptIndex,
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

  replayController(options.coordinator);
  const tree = (
    await runProcess("git", ["rev-parse", `${head}^{tree}`], { cwd: options.repositoryRoot })
  ).stdout.trim();
  await recordControllerEvent(options.coordinator, {
    kind: "integration-observed",
    commit: head,
    tree,
  });
  let verification: IndependentVerification | null = null;
  if (options.goalContract !== undefined && !options.abortSignal.aborted) {
    const patch = (
      await runProcess("git", ["diff", "--binary", baseCommit, head], {
        cwd: options.repositoryRoot,
        maxBuffer: 64_000_000,
      })
    ).stdout;
    const commands = createNodeCommandRunner(
      options.clock,
      harnessChildEnvironment(),
      undefined,
      options.abortSignal,
      options.runContext?.tests,
    );
    verification = await verifyIndependently({
      repositoryRoot: options.repositoryRoot,
      baseCommit,
      patch,
      immutablePaths: options.immutablePaths ?? [],
      clock: options.clock,
      timeoutMs: Math.min(120_000, options.remainingWallMs?.() ?? 120_000),
      commands,
      ...(options.isolation === undefined
        ? {}
        : {
            commandsForCheckout: async (checkout: string) =>
              createNodeCommandRunner(
                options.clock,
                harnessChildEnvironment(),
                options.isolation?.(checkout),
                options.abortSignal,
                options.runContext?.tests,
              ),
          }),
      goal: { contract: options.goalContract, evidence: options.coordinator, tree },
    });
    await options.coordinator.record({
      type: "independent-verification",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue(verification),
    });
  }
  const outcome = await assessController({
    evidence: options.coordinator,
    board: replayController(options.coordinator),
    taskIds: Array.from(
      { length: graph?.nodes.length ?? options.tasks.length },
      (_, index) => `task-${index + 1}`,
    ),
    workers,
    landings,
    tree,
    goal: options.goalContract ?? null,
    verification,
    cancelled: options.abortSignal.aborted,
    usage: options.runContext?.accounting() ?? {
      spent: 0,
      reserved: 0,
      unknownCalls: 0,
      remaining: 0,
    },
  });
  return {
    outcome,
    verification,
    workers: [...workers].sort(
      (left, right) =>
        left.attemptIndex - right.attemptIndex ||
        left.workerId.localeCompare(right.workerId, "en", { numeric: true }),
    ),
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
        .filter((worker) => worker.green && worker.commit !== null)
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
