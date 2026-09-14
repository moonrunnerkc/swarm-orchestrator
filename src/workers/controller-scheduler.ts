import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { createResourcePool } from "../exec/resource-pool.ts";
import { controllerEvents, recordControllerEvent } from "./controller-events.ts";
import { runOneWorker } from "./controller-jobs.ts";
import { applyControllerRevision, consumeCoordination } from "./controller-revisions.ts";
import { readyTasks } from "./controller-schedule.ts";
import { candidateIsCurrent, recordTransition, replayController } from "./controller-state.ts";
import type { PlannedAttempt } from "./fan-out.ts";
import type { ControllerNode } from "./graph-revision.ts";
import type { ParallelRunOptions, WorkerResult } from "./parallel-run.ts";
import type { TrailPeer } from "./trail.ts";

const git = promisify(execFile);

export async function runControllerSchedule(settings: {
  options: ParallelRunOptions;
  criteriaRef: string;
  planned: readonly PlannedAttempt[];
  registered: TrailPeer[];
  workers: WorkerResult[];
  head: () => string;
  integrate: (workers: readonly WorkerResult[]) => Promise<void>;
}): Promise<void> {
  const { options, workers } = settings;
  const pool = createResourcePool(options.concurrency > 0 ? options.concurrency : 128);
  const active = new Map<string, Promise<{ taskId: string; workers: WorkerResult[] }>>();
  const limit = options.concurrency > 0 ? options.concurrency : 128;
  for (const revision of options.resume ? [] : (options.revisions ?? []))
    await applyControllerRevision(options.coordinator, revision, "user");

  const launch = (node: ControllerNode, attempts: readonly PlannedAttempt[], feedback?: string) => {
    const graphRevision = replayController(options.coordinator).graph?.revision;
    if (graphRevision === undefined) throw new Error("dispatch has no current graph");
    const base = settings.head();
    const pending = Promise.all(
      attempts.map(async (attempt) => {
        let admitted = false;
        try {
          return await pool.run(() => {
            admitted = true;
            return runOneWorker(
              attempt,
              base,
              settings.criteriaRef,
              options,
              settings.registered,
              node.contract,
              feedback,
              graphRevision,
            );
          }, options.abortSignal);
        } catch (cause) {
          if (admitted || !options.abortSignal.aborted || cause !== options.abortSignal.reason)
            throw cause;
          await recordControllerEvent(options.coordinator, {
            kind: "attempt-not-dispatched",
            taskId: node.id,
            workerId: attempt.workerId,
            reason: "cancelled while waiting for a worktree slot",
          });
          return null;
        }
      }),
    ).then((completed) => ({
      taskId: node.id,
      workers: completed.filter((worker) => worker !== null),
    }));
    active.set(node.id, pending);
  };

  async function repair(node: ControllerNode): Promise<boolean> {
    const previous = [...workers].reverse().find((worker) => worker.taskId === node.id);
    if (previous === undefined) return false;
    const board = replayController(options.coordinator);
    const events = controllerEvents(options.coordinator);
    const earlier = events.filter(
      (event) => event.kind === "repair-requested" && event.taskId === node.id,
    );
    const attempt = earlier.length + 1;
    const stale = board.stale.has(previous.workerId);
    if (
      attempt > (options.repairAttempts ?? 2) ||
      (previous.commit === null && !stale && !options.resume)
    )
      return false;
    const rejection = options.coordinator
      .records()
      .filter((record) => record.type === "merge-attempt")
      .map((record) => options.coordinator.payloads().get(record.payloadDigest))
      .reverse()
      .find(
        (payload) =>
          payload !== null &&
          typeof payload === "object" &&
          "workerId" in payload &&
          payload.workerId === previous.workerId &&
          "landed" in payload &&
          payload.landed === false,
      );
    const feedback =
      rejection !== null &&
      typeof rejection === "object" &&
      "detail" in rejection &&
      typeof rejection.detail === "string"
        ? rejection.detail
        : previous.detail;
    const patch =
      previous.commit === null
        ? ""
        : (
            await git("git", ["diff", "--binary", previous.baseCommit, previous.commit], {
              cwd: options.repositoryRoot,
              env: harnessChildEnvironment().variables,
              timeout: 30_000,
              maxBuffer: 64_000_000,
            })
          ).stdout;
    const failureDigest = createHash("sha256")
      .update(JSON.stringify([settings.head(), stale ? board.graph?.revision : "repair", patch]))
      .digest("hex");
    if (
      earlier.some(
        (event) =>
          event.kind === "repair-requested" &&
          (event.failureDigest ?? event.failureKey) === failureDigest,
      )
    ) {
      await recordControllerEvent(options.coordinator, {
        kind: "repair-exhausted",
        taskId: node.id,
        previousWorkerId: previous.workerId,
        baseCommit: settings.head(),
        reason: `repeated ineffective repair: ${feedback}`,
      });
      return false;
    }
    const workerId = `${node.id}-repair-${attempt}`;
    await recordControllerEvent(options.coordinator, {
      kind: "repair-requested",
      taskId: node.id,
      workerId,
      previousWorkerId: previous.workerId,
      previousCommit: previous.commit,
      baseCommit: settings.head(),
      attempt,
      reason: stale ? `dependency or requirement ownership changed; ${feedback}` : feedback,
      failureDigest,
    });
    launch(
      node,
      [
        {
          workerId,
          taskId: node.id,
          task: node.contract.objective,
          attemptIndex: options.redundancy + attempt - 1,
          sampling: null,
        },
      ],
      `Previous candidate ${previous.commit ?? "none"}; current integration base ${settings.head()}.\nFailure observation:\n${feedback.slice(0, 24000)}\nPrevious patch (retained in Git; excerpt limited to 48000 characters):\n${patch.slice(0, 48000)}\nRepair this task against the current tree and preserve already accepted work. The current controller contract is authoritative.`,
    );
    return true;
  }

  if (options.resume) {
    const previous = replayController(options.coordinator);
    for (const node of previous.graph?.nodes ?? [])
      if (["blocked", "cancelled", "failed"].includes(previous.states.get(node.id) ?? "pending"))
        await recordTransition(options.coordinator, {
          kind: "task-reopened",
          taskId: node.id,
          reason: "explicit resume within the original remaining policy and budget",
        });
    for (const worker of workers)
      if (!candidateIsCurrent(previous, worker) && !previous.stale.has(worker.workerId))
        await recordTransition(options.coordinator, {
          kind: "candidate-stale",
          workerId: worker.workerId,
          currentRevision: previous.graph?.revision ?? "",
          reason: "recovered candidate belongs to an invalidated task or dependency revision",
        });
    for (const node of previous.graph?.nodes ?? []) {
      if (previous.states.get(node.id) !== "candidate" || options.abortSignal.aborted) continue;
      const candidates = workers.filter(
        (worker) =>
          worker.taskId === node.id &&
          candidateIsCurrent(previous, worker) &&
          !previous.stale.has(worker.workerId),
      );
      if (candidates.length > 0) await settings.integrate(candidates);
    }
  }
  try {
    for (;;) {
      if (options.peerInformation !== false)
        await consumeCoordination({
          evidence: options.coordinator,
          peers: settings.registered,
          adaptation: options.adaptation !== false,
        });
      const board = replayController(options.coordinator);
      if (board.graph === null) throw new Error("controller history lacks its graph");
      for (const taskId of active.keys()) board.states.set(taskId, "running");
      if (!options.abortSignal.aborted) {
        const scheduled = board.graph.nodes.map((node) => ({
          id: node.id,
          dependsOn: node.dependsOn,
          files: node.contract.scopeKind === "workspace" ? [] : node.contract.allowedPaths,
        }));
        for (const taskId of readyTasks(scheduled, board.states)) {
          if (active.size >= limit) break;
          const node = board.graph.nodes.find((node) => node.id === taskId);
          if (node === undefined)
            throw new Error(`ready task ${taskId} disappeared from its graph`);
          if (
            [...board.dispatches.values()].some(
              (dispatch) =>
                dispatch.taskId === taskId && !board.reconciledDispatches.has(dispatch.workerId),
            )
          ) {
            if (active.size === 0 && (await repair(node))) break;
            continue;
          }
          options.owner?.assertOwned();
          const initial = settings.planned.filter((attempt) => attempt.taskId === taskId);
          const resumed = [...board.dispatches.values()].filter(
            (dispatch) => dispatch.taskId === taskId,
          ).length;
          launch(
            node,
            resumed > 0
              ? [
                  {
                    workerId: `${taskId}-resume-${resumed}`,
                    taskId,
                    task: node.contract.objective,
                    attemptIndex: 0,
                    sampling: null,
                  },
                ]
              : initial.length > 0
                ? initial
                : [
                    {
                      workerId: `${taskId}-attempt-1`,
                      taskId,
                      task: node.contract.objective,
                      attemptIndex: 0,
                      sampling: null,
                    },
                  ],
          );
        }
      }
      if (active.size === 0) {
        let launched = false;
        if (!options.abortSignal.aborted) {
          for (const node of board.graph.nodes) {
            if (
              ["failed", "pending"].includes(board.states.get(node.id) ?? "pending") &&
              node.dependsOn.every((dependency) => board.states.get(dependency) === "accepted") &&
              (await repair(node))
            ) {
              launched = true;
              break;
            }
          }
        }
        if (!launched) break;
      }
      const completed = await Promise.race(active.values());
      active.delete(completed.taskId);
      workers.push(...completed.workers);
      if (options.peerInformation !== false)
        await consumeCoordination({
          evidence: options.coordinator,
          peers: settings.registered,
          adaptation: options.adaptation !== false,
        });
      const current = replayController(options.coordinator);
      const eligible: WorkerResult[] = [];
      for (const worker of completed.workers) {
        if (candidateIsCurrent(current, worker)) eligible.push(worker);
        else
          await recordTransition(options.coordinator, {
            kind: "candidate-stale",
            workerId: worker.workerId,
            currentRevision: current.graph?.revision ?? "",
            reason:
              "candidate's task or dependencies changed after dispatch; retained for bounded repair",
          });
      }
      if (!options.abortSignal.aborted) await settings.integrate(eligible);
    }
    const terminal = replayController(options.coordinator);
    for (const node of terminal.graph?.nodes ?? []) {
      if (terminal.states.get(node.id) === "accepted") continue;
      const previous = [...workers].reverse().find((worker) => worker.taskId === node.id);
      const reason = options.abortSignal.aborted
        ? "run cancelled; no further dispatch"
        : previous === undefined
          ? `unaccepted prerequisites: ${node.dependsOn.filter((id) => terminal.states.get(id) !== "accepted").join(", ")}`
          : `bounded repair exhausted: ${previous.detail}`;
      await recordTransition(options.coordinator, {
        kind: "task-blocked",
        taskId: node.id,
        reason,
      });
      if (previous !== undefined && !options.abortSignal.aborted)
        await recordControllerEvent(options.coordinator, {
          kind: "repair-exhausted",
          taskId: node.id,
          previousWorkerId: previous.workerId,
          baseCommit: settings.head(),
          reason,
        });
    }
  } catch (cause) {
    try {
      await options.runContext?.stop("controller failed; active jobs stopped for reconciliation");
    } finally {
      await Promise.allSettled(active.values());
    }
    throw cause;
  }
}
