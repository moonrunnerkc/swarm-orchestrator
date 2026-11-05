import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { snapshotWorkingTree, type VerifyResult } from "swarm-verify";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import {
  type ApprovalMode,
  type ConfirmationPrompt,
  createChokepoint,
} from "../tools/chokepoint.ts";
import { type Progress, runAttempts } from "./attempts.ts";
import { authoringStage } from "./authoring.ts";
import { finalize } from "./finalize.ts";
import { gitText } from "./git.ts";
import type { StopReason } from "./loop.ts";
import type { ModelClient } from "./model.ts";
import { assembleReport, type RunReportFile, writeReport } from "./report.ts";
import { initialRecord } from "./requirement-record.ts";
import { runEnvironment } from "./run-environment.ts";
import { stablePrefix } from "./stable-prefix.ts";
import { behaviorChangeNote, createVerifier, swarmHome } from "./verification.ts";
import { versionConstraintsOf, workspaceDependencies } from "./version-constraints.ts";
import { deliver, openWorkspace } from "./workspace.ts";

export interface RunOptions {
  readonly workspace: string;
  readonly task: string;
  readonly model: ModelClient;
  /** Why this model, in one line, for the report. */
  readonly modelReason: string;
  /** A stronger model to hand the run to once, when this one stops making progress. */
  readonly escalation?: ModelClient | null;
  /** The money a turn costs where it is known; "none (local runtime)" for a local model. */
  readonly cost: string;
  readonly contextTokens: number;
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly turnTokens: number;
  /** One wall-time budget for the whole run, final verification included; null for none. */
  readonly maxWallMs: number | null;
  /** Where the verifier runs the checks: a container (the default), or the host, reported so. */
  readonly isolation: "isolated" | "host";
  /** On the host, verify with the workspace's installed dependencies, reported as not reproducible. */
  readonly dependencies?: "linked";
  /** Whether to apply the delivered patch to the workspace when it is still as the run found it. */
  readonly apply: boolean;
  readonly approval: ApprovalMode;
  /** The user's authorization to change what existing tests expect; never the model's. */
  readonly behaviorChange?: "none" | "authorized";
  /** One fresh-context review of a completed change; off unless asked for. */
  readonly review?: boolean;
  readonly confirm: ConfirmationPrompt;
  readonly version: string;
  readonly signal?: AbortSignal | undefined;
  readonly log: (line: string) => void;
}

export interface RunReport {
  readonly stop: StopReason | "cancelled" | "interrupted";
  readonly report: RunReportFile;
  readonly sessionDirectory: string;
  readonly reportPath: string;
  readonly result: VerifyResult | null;
}

export { swarmHome };

/**
 * Runs the loop in a managed worktree seeded with the user's tree as it stands, finalizes the
 * tree it leaves whatever ends the loop, and delivers the patch to the workspace only where the
 * workspace has not changed meanwhile.
 */
export async function runAgent(options: RunOptions): Promise<RunReport> {
  const started = Date.now();
  const repository = await gitText(options.workspace, ["rev-parse", "--show-toplevel"]);
  const home = swarmHome();
  const evidence = await openEvidenceSession({
    root: join(home, "sessions"),
    sessionId: createSessionId(Date.now()),
    now: Date.now,
  });
  const final = join(evidence.directory, "final");
  await mkdir(final, { recursive: true, mode: 0o700 });
  // Beside the repository, so a dependency it names by a relative path (file:../sibling) resolves
  // from the worktree as it does from the repository.
  const managed = await openWorkspace(
    repository,
    join(dirname(repository), `.${basename(repository)}.swarm-${evidence.sessionId}`),
    final,
  );
  try {
    const workspace = managed.directory;
    const base = managed.start.base;
    const { guard, deadline, python, execution } = await runEnvironment({
      options,
      workspace,
      repository,
      home,
      childHome: join(evidence.directory, "home"),
      started,
    });
    // After the Python environment, so the probe and the layout see the .venv the model will.
    const prefix = await stablePrefix({
      workspace,
      env: guard.childEnvironment.variables,
      task: options.task,
      checks: options.isolation,
      signal: options.signal,
    });
    const { instructions, rendered, digests, promptSha256 } = prefix;
    await evidence.record({
      type: "session-started",
      actor: "harness",
      provenance: ["user"],
      payload: {
        task: options.task,
        model: options.model.model,
        base,
        head: managed.start.head,
        startingEdits: [...managed.start.paths],
        python: python === null ? null : { ...python },
        promptSha256,
        environment: prefix.environment,
        instructions: digests,
        instructionNotes: instructions.notes,
        behaviorChange: options.behaviorChange ?? "none",
      },
    });

    const declared = await workspaceDependencies(workspace);
    const stated = versionConstraintsOf(options.task, declared.dependencies);
    const progress: Progress = {
      model: options.model,
      loops: [],
      record: initialRecord(options.task, stated.constraints, [...declared.notes, ...stated.notes]),
      review: null,
      escalated: false,
    };
    const verifier = createVerifier({
      workspace,
      base,
      execution,
      behaviorChange: options.behaviorChange ?? "none",
      evidence,
      producer: {
        name: "swarm-orchestrator",
        version: options.version,
        promptSha256,
        instructions: digests,
      },
      model: () => progress.model.model,
      signal: options.signal,
    });
    const chokepoint = createChokepoint({
      guard,
      evidence,
      approval: options.approval,
      confirm: options.confirm,
      timeoutMs: 600_000,
      signal: options.signal,
    });

    let stop: RunReport["stop"] = "interrupted";
    let reason: string | null = null;
    let authoring: Awaited<ReturnType<typeof authoringStage>> = {
      record: progress.record,
      authored: [],
    };
    try {
      // Checks for R1 written apart from the change, before its first edit (check-author.ts).
      authoring = await authoringStage({
        model: options.model,
        chokepoint,
        evidence,
        workspace,
        task: options.task,
        record: progress.record,
        home,
        turnTokens: options.turnTokens,
        signal: options.signal,
      });
      progress.record = authoring.record;
      ({ stop, reason } = await runAttempts({
        shared: {
          task: options.task,
          chokepoint,
          evidence,
          environment: prefix.environment.block,
          instructions: rendered,
          status: () => gitText(workspace, ["status", "--short", "--", ".", ":(exclude).swarm"]),
          // The patch the verifier would judge, new files included, kept in the session.
          diff: async () =>
            readFile(
              (await snapshotWorkingTree(workspace, base, join(evidence.directory, "turn.patch")))
                .path,
              "utf8",
            ),
          verify: verifier.tree,
          turnTokens: options.turnTokens,
          turnTime: () => ({
            leftMs: deadline - Date.now() - verifier.reserveMs(),
            wallMs: options.maxWallMs ?? Number.POSITIVE_INFINITY,
          }),
          contextTokens: options.contextTokens,
          outputs: { directory: join(workspace, ".swarm", "outputs"), root: workspace },
          signal: options.signal,
          log: options.log,
        },
        escalation: options.escalation ?? null,
        review: options.review === true,
        maxSteps: options.maxSteps,
        maxTokens: options.maxTokens,
        verifier,
        evidence,
        base,
        reviewDirectory: join(evidence.directory, "review"),
        progress,
      }));
    } catch (error) {
      stop = options.signal?.aborted ? "cancelled" : "interrupted";
      // A cancelled run says why it was cancelled, not which operation the abort interrupted.
      const cause = options.signal?.aborted ? options.signal.reason : error;
      reason = cause instanceof Error ? cause.message : String(cause);
    }

    options.log("finalizing the delivered tree");
    const finalized = await finalize({
      workspace,
      base,
      directory: final,
      record: progress.record,
      held: verifier.held(),
      cannotVerify:
        stop === "cancelled"
          ? "the run was cancelled"
          : Date.now() >= deadline
            ? "the run's time budget was spent"
            : null,
      verify: (snapshot) =>
        verifier.snapshot(snapshot, progress.record, join(final, "verification")),
    });
    const delivery =
      options.apply && finalized.snapshot.sha256 !== emptySha256
        ? await deliver(repository, managed.start, finalized.snapshot.path, final)
        : {
            applied: false as const,
            reason: options.apply ? "the run changed nothing" : "kept as a patch, as asked",
          };
    const report = assembleReport({
      options,
      stop,
      reason,
      finalized,
      loops: progress.loops,
      review: progress.review,
      escalated: progress.escalated,
      digests,
      notes: [
        ...instructions.notes,
        ...(options.behaviorChange === "authorized" ? [behaviorChangeNote(finalized.result)] : []),
      ],
      start: managed.start,
      python,
      delivery,
      startedAt: started,
      authored: authoring.authored,
    });
    const paths = await writeReport(final, report);
    await evidence.record({
      type: "session-stopped",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        stop,
        reason,
        state: finalized.state,
        patchSha256: finalized.snapshot.sha256,
        verification: finalized.verification,
        applied: delivery.applied,
        report: paths.json,
      },
    });
    return {
      stop,
      report,
      sessionDirectory: evidence.directory,
      reportPath: paths.markdown,
      result: finalized.result,
    };
  } finally {
    await managed.remove();
  }
}

/** sha256 of no bytes: a patch that changes nothing. */
const emptySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
