import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { asJsonValue } from "../evidence/canonical-json.ts";
import { hashOfRecord } from "../evidence/ledger-record.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { repairRuntimeResources } from "../exec/runtime-resource.ts";
import { createFileSetRegistry } from "../gates/file-set.ts";
import { emptyMeasureSnapshot } from "../gates/measure-snapshot.ts";
import { controllerConfiguration } from "./controller-configuration.ts";
import {
  appendControllerRecord,
  candidateSchema,
  recordTransition,
  replayController,
} from "./controller-state.ts";
import type { QueueLanding } from "./merge-queue.ts";
import type { ParallelRunOptions, WorkerResult } from "./parallel-run.ts";
import { headCommit, reopenWorktree, resetHard } from "./worktree.ts";

const execute = promisify(execFile);
const mergeSchema = z.object({
  workerId: z.string(),
  branch: z.string(),
  landed: z.boolean(),
  reason: z.enum(["merge-conflict", "gates", "ratchet", "cancelled"]).nullable(),
  detail: z.string(),
  commit: z.string().nullable(),
});
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

/** Reconciliation retains ambiguous work and only replays Git effects whose current state is attributable. */
export async function reconcileController(
  options: Pick<ParallelRunOptions, "coordinator" | "owner" | "createWorkerSession">,
  signal?: AbortSignal,
): Promise<{ workers: WorkerResult[]; landings: QueueLanding[]; head: string }> {
  options.owner?.assertOwned();
  const configuration = controllerConfiguration(options.coordinator);
  if (configuration === null)
    throw new Error("controller configuration is unavailable; preserve and inspect this history");
  const git = async (args: readonly string[]) =>
    (
      await execute("git", [...args], {
        cwd: configuration.repositoryRoot,
        env: harnessChildEnvironment().variables,
        timeout: 30_000,
        maxBuffer: 64_000_000,
        ...(signal === undefined ? {} : { signal }),
      })
    ).stdout.trim();
  const reference = async (branch: string) =>
    (await git(["for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`])) || null;
  let board = replayController(options.coordinator);
  const integrationBranch = `swarm/${configuration.runId}/integration`;
  const integrationPath = join(configuration.scratchRoot, "integration");
  const integrationHead = await reference(integrationBranch);
  if (
    board.resource !== null &&
    (board.resource.path !== integrationPath || board.resource.branch !== integrationBranch)
  )
    throw new Error("integration resource differs from the controller's owned location");
  const workers: WorkerResult[] = [];
  for (const intent of board.dispatches.values()) {
    signal?.throwIfAborted();
    if (
      intent.path !== join(configuration.scratchRoot, intent.workerId) ||
      intent.branch !== `swarm/${configuration.runId}/${intent.workerId}`
    )
      throw new Error(`dispatch ${intent.workerId} names an unowned resource`);
    if (intent.sessionDirectory !== undefined && !(await exists(intent.sessionDirectory)))
      throw new Error(
        `worker ${intent.workerId} session directory is missing; preserve and reconcile lost history`,
      );
    const capturedCandidate = board.candidates.get(intent.workerId);
    if (
      intent.sessionDirectory !== undefined &&
      capturedCandidate !== undefined &&
      capturedCandidate.chainHead !== "genesis" &&
      !(await exists(join(intent.sessionDirectory, "ledger.jsonl")))
    )
      throw new Error(
        `worker ${intent.workerId} candidate ledger is missing; preserve and reconcile lost history`,
      );
    const evidence = await options.createWorkerSession(intent.workerId);
    if (intent.sessionDirectory !== undefined && evidence.directory !== intent.sessionDirectory)
      throw new Error(`worker ${intent.workerId} session location changed`);
    if (evidence.sessionId !== intent.sessionId)
      throw new Error(`worker ${intent.workerId} session identity changed; preserve both chains`);
    let candidate = board.candidates.get(intent.workerId);
    const branchHead = await reference(intent.branch);
    const present = await exists(intent.path);
    if (candidate === undefined && !board.reconciledDispatches.has(intent.workerId)) {
      refuseAmbiguousEffects(evidence);
      if (present) {
        const tree = await reopenWorktree({
          repositoryRoot: configuration.repositoryRoot,
          path: intent.path,
          branch: intent.branch,
          baseRef: intent.baseCommit,
        });
        const before = await headCommit(intent.path);
        await recordTransition(options.coordinator, {
          kind: "recovery-commit-intent",
          workerId: intent.workerId,
          branch: intent.branch,
          baseCommit: before,
        });
        const captured = await tree.commitAll(
          `${intent.workerId}: retain interrupted work for revalidation`,
          signal,
        );
        const retained = captured ?? (before === intent.baseCommit ? null : before);
        candidate = candidateSchema.parse({
          workerId: intent.workerId,
          taskId: intent.taskId,
          attemptIndex: intent.attemptIndex,
          task:
            board.graphs.get(intent.graphRevision)?.nodes.find((node) => node.id === intent.taskId)
              ?.contract.objective ?? "interrupted task",
          branch: intent.branch,
          baseCommit: intent.baseCommit,
          graphRevision: intent.graphRevision,
          green: false,
          commit: retained,
          declaredFiles: [...createFileSetRegistry(evidence).state().allowed].sort(),
          detail:
            "interrupted work retained; acceptance and measurements must be obtained by a new bounded attempt",
          measures: emptyMeasureSnapshot,
          erosions: 0,
          changedFiles: 0,
          addedLines: 0,
          sessionId: evidence.sessionId,
          chainHead: evidence.head().hash,
        });
        await appendControllerRecord(
          options.coordinator,
          "controller-candidate",
          asJsonValue(candidate),
        );
      } else if (branchHead !== null) {
        throw new Error(
          `worker ${intent.workerId} has a branch but no worktree or candidate record; preserve the branch and reconcile its origin`,
        );
      } else {
        if (
          options.coordinator.records().some((record) => {
            const event = options.coordinator.payloads().get(record.payloadDigest);
            return (
              record.type === "controller-transition" &&
              event !== null &&
              typeof event === "object" &&
              "kind" in event &&
              event.kind === "worktree-created" &&
              "workerId" in event &&
              event.workerId === intent.workerId
            );
          }) ||
          evidence
            .records()
            .some((record) =>
              ["model-call-started", "model-call", "tool-call"].includes(record.type),
            )
        )
          throw new Error(
            `worker ${intent.workerId} lost its worktree after recorded execution; reconcile before any retry`,
          );
        await recordTransition(options.coordinator, {
          kind: "dispatch-reconciled",
          workerId: intent.workerId,
          disposition: "not-started",
          reason:
            "no worktree, branch or recorded execution exists; prior owner is no longer running",
        });
      }
    }
    if (candidate === undefined) continue;
    if (
      candidate.chainHead !== "genesis" &&
      !evidence.records().some((record) => hashOfRecord(record) === candidate.chainHead)
    )
      throw new Error(`worker ${intent.workerId} candidate cites missing or altered evidence`);
    if (candidate.commit !== null) {
      await git(["cat-file", "-e", `${candidate.commit}^{commit}`]);
      await git(["merge-base", "--is-ancestor", candidate.baseCommit, candidate.commit]);
      const currentBranch = await reference(intent.branch);
      if (currentBranch !== null && currentBranch !== candidate.commit)
        throw new Error(
          `worker ${intent.workerId} branch changed after its captured candidate; no cleanup performed`,
        );
      if (currentBranch === null) {
        if (integrationHead === null)
          throw new Error(
            `retained candidate ${candidate.commit} has no branch or integrated owner`,
          );
        await git(["merge-base", "--is-ancestor", candidate.commit, integrationHead]);
      }
    }
    if (present && !board.cleaned.has(intent.workerId)) {
      const tree = await reopenWorktree({
        repositoryRoot: configuration.repositoryRoot,
        path: intent.path,
        branch: intent.branch,
        baseRef: intent.baseCommit,
      });
      if ((await headCommit(intent.path)) !== (candidate.commit ?? candidate.baseCommit))
        throw new Error(`worker ${intent.workerId} worktree moved since capture; preserve it`);
      await recordTransition(options.coordinator, {
        kind: "cleanup-intent",
        workerId: intent.workerId,
        path: intent.path,
        branch: intent.branch,
      });
      await tree.remove(signal);
      await recordTransition(options.coordinator, {
        kind: "cleanup-completed",
        workerId: intent.workerId,
        path: intent.path,
        branch: intent.branch,
      });
    } else if (
      !present &&
      board.cleanupIntents.has(intent.workerId) &&
      !board.cleaned.has(intent.workerId)
    ) {
      await recordTransition(options.coordinator, {
        kind: "cleanup-completed",
        workerId: intent.workerId,
        path: intent.path,
        branch: intent.branch,
      });
    }
    const { sessionId: _sessionId, chainHead: _chainHead, ...snapshot } = candidate;
    workers.push({ ...snapshot, evidence });
  }
  board = replayController(options.coordinator);
  for (const intent of board.integrations.values()) {
    signal?.throwIfAborted();
    if (board.completedIntegrations.has(intent.effectId)) continue;
    const intentRecord = options.coordinator.records().find((record) => {
      const event = options.coordinator.payloads().get(record.payloadDigest);
      return (
        record.type === "controller-transition" &&
        event !== null &&
        typeof event === "object" &&
        "kind" in event &&
        event.kind === "integration-intent" &&
        "effectId" in event &&
        event.effectId === intent.effectId
      );
    });
    if (intentRecord === undefined)
      throw new Error("integration intent disappeared during reconciliation");
    const matching = options.coordinator
      .records()
      .filter(
        (record) =>
          record.type === "merge-attempt" &&
          record.actor === "harness" &&
          record.sequence > intentRecord.sequence,
      )
      .find((record) => {
        const observed = options.coordinator.payloads().get(record.payloadDigest);
        return (
          observed !== null &&
          typeof observed === "object" &&
          "workerId" in observed &&
          observed.workerId === intent.workerId
        );
      });
    if (matching !== undefined) {
      const observed = mergeSchema.parse(
        options.coordinator.payloads().get(matching.payloadDigest),
      );
      if (integrationHead !== (observed.landed ? observed.commit : intent.baseCommit))
        throw new Error(
          `integration ${intent.effectId} observation does not match the actual branch; preserve and reconcile`,
        );
      await recordTransition(options.coordinator, {
        kind: "integration-completed",
        effectId: intent.effectId,
        landed: observed.landed,
        commit: observed.commit,
        observation: matching.payloadDigest,
      });
      continue;
    }
    if (!(await exists(integrationPath)))
      throw new Error(
        `integration ${intent.effectId} stopped without its worktree; retain ${integrationBranch} and reconcile`,
      );
    await reopenWorktree({
      repositoryRoot: configuration.repositoryRoot,
      path: integrationPath,
      branch: integrationBranch,
      baseRef: intent.baseCommit,
    });
    const uncommitted = await git([
      "-C",
      integrationPath,
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]);
    if (uncommitted !== "")
      throw new Error(
        `integration ${intent.effectId} has uncommitted files; preserve them and reconcile before resetting`,
      );
    const observedHead = await headCommit(integrationPath);
    if (observedHead !== intent.baseCommit) {
      const parents = (await git(["rev-list", "--parents", "-n", "1", observedHead]))
        .split(" ")
        .slice(1);
      if (
        parents.length !== 2 ||
        parents[0] !== intent.baseCommit ||
        parents[1] !== intent.candidateCommit
      )
        throw new Error(
          `integration ${intent.effectId} moved to an unattributable commit; preserve it`,
        );
      await recordTransition(options.coordinator, {
        kind: "recovery-ref-intent",
        effectId: intent.effectId,
        commit: observedHead,
      });
      const retentionRef = `refs/swarm-recovery/${configuration.runId}/${intent.effectId}`;
      const retained = await git(["for-each-ref", "--format=%(objectname)", retentionRef]);
      if (retained !== "" && retained !== observedHead)
        throw new Error(`retention reference ${retentionRef} changed; preserve it`);
      if (retained === "")
        await git(["update-ref", retentionRef, observedHead, "0".repeat(observedHead.length)]);
    }
    await recordTransition(options.coordinator, {
      kind: "recovery-reset-intent",
      effectId: intent.effectId,
      observedCommit: observedHead,
      targetCommit: intent.baseCommit,
    });
    await resetHard(integrationPath, intent.baseCommit, signal);
    await recordTransition(options.coordinator, {
      kind: "integration-abandoned",
      effectId: intent.effectId,
      retainedCommit: observedHead === intent.baseCommit ? null : observedHead,
      reason:
        "interrupted integration was not accepted; its candidate is retained and all checks will rerun",
    });
  }
  board = replayController(options.coordinator);
  const head = board.head ?? configuration.baseCommit;
  const actual = await reference(integrationBranch);
  if (actual !== null && actual !== head)
    throw new Error(
      `integration branch is ${actual}, recorded accepted head is ${head}; preserve and reconcile`,
    );
  const landings = options.coordinator
    .records()
    .filter((record) => record.type === "merge-attempt")
    .map((record): QueueLanding => {
      const captured = mergeSchema.parse(options.coordinator.payloads().get(record.payloadDigest));
      return {
        ...captured,
        feedback: captured.detail,
        cycle: null,
        decision: null,
        record: record.payloadDigest,
      };
    });
  return { workers, landings, head };
}

function refuseAmbiguousEffects(evidence: EvidenceRecorder): void {
  const outstanding = new Map<string, string>();
  for (const record of evidence.records()) {
    if (record.type !== "tool-call") continue;
    const call = z
      .object({ callId: z.string(), toolName: z.string(), decision: z.string() })
      .parse(evidence.payloads().get(record.payloadDigest));
    if (call.decision === "requested") outstanding.set(call.callId, call.toolName);
    else outstanding.delete(call.callId);
  }
  const ambiguous = [...outstanding].filter(
    ([, tool]) => !["read", "list", "search"].includes(tool),
  );
  if (ambiguous.length > 0)
    throw new Error(
      `reconcile ambiguous external effects before resuming ${evidence.sessionId}: ${ambiguous.map(([id, tool]) => `${tool}:${id}`).join(", ")}; no effect was replayed`,
    );
}

export async function repairControllerRuntime(
  options: Pick<ParallelRunOptions, "coordinator" | "owner" | "createWorkerSession">,
  signal: AbortSignal,
): Promise<void> {
  options.owner?.assertOwned();
  await repairRuntimeResources(
    dirname(options.coordinator.directory),
    options.coordinator.sessionId,
    undefined,
    options.coordinator,
    signal,
  );
  for (const intent of replayController(options.coordinator).dispatches.values()) {
    signal.throwIfAborted();
    if (intent.sessionDirectory !== undefined && !(await exists(intent.sessionDirectory)))
      throw new Error(
        `worker ${intent.workerId} session directory is missing; preserve and reconcile`,
      );
    const evidence = await options.createWorkerSession(intent.workerId);
    if (evidence.sessionId !== intent.sessionId)
      throw new Error("runtime repair worker identity changed");
    await repairRuntimeResources(
      dirname(evidence.directory),
      evidence.sessionId,
      undefined,
      evidence,
      signal,
    );
  }
}
