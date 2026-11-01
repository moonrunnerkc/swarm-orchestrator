import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { VerifyResult } from "swarm-verify";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import {
  type ApprovalMode,
  type ConfirmationPrompt,
  createChokepoint,
} from "../tools/chokepoint.ts";
import { createPolicyGuard, defaultShellAllowlist } from "../tools/policy-guard.ts";
import { finalize } from "./finalize.ts";
import { gitText } from "./git.ts";
import { loadInstructions, renderInstructions } from "./instructions.ts";
import { type LoopResult, runLoop, type StopReason } from "./loop.ts";
import type { ModelClient } from "./model.ts";
import { systemPrompt } from "./prompt.ts";
import { assembleReport, type RunReportFile, writeReport } from "./report.ts";
import { initialRecord } from "./requirement-record.ts";
import { behaviorChangeNote, createVerifier, dependencyPolicy, swarmHome } from "./verification.ts";
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
  /** Whether to apply the delivered patch to the workspace when it is still as the run found it. */
  readonly apply: boolean;
  readonly approval: ApprovalMode;
  /** The user's authorization to change what existing tests expect; never the model's. */
  readonly behaviorChange?: "none" | "authorized";
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

/** Stops that say the model, not the environment, was the problem: worth one stronger model. */
const modelRelated: ReadonlySet<StopReason> = new Set(["no-progress", "unusable-replies"]);

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
    const childHome = join(evidence.directory, "home");
    await mkdir(childHome, { recursive: true, mode: 0o700 });
    const guard = createPolicyGuard({
      workspaceRoot: workspace,
      homeDir: homedir(),
      shellAllowlist: defaultShellAllowlist,
      // The session store, its verifications and the sealed held-out checks are never the agent's to read.
      deniedRoots: [home],
      childHomeDir: childHome,
    });
    const execution =
      options.isolation === "isolated"
        ? ({ mode: "isolated", network: "closed", dependencies: "prepare" } as const)
        : ({
            mode: "host",
            network: "open",
            dependencies: await dependencyPolicy(repository),
          } as const);
    const instructions = await loadInstructions(workspace);
    const rendered = renderInstructions(instructions);
    const digests = instructions.loaded.map(({ path, sha256 }) => ({ path, sha256 }));
    const promptSha256 = createHash("sha256")
      .update(`${systemPrompt}\n${rendered}\n${options.task}`)
      .digest("hex");
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
        promptSha256,
        instructions: digests,
        instructionNotes: instructions.notes,
        behaviorChange: options.behaviorChange ?? "none",
      },
    });

    let model = options.model;
    const deadline =
      options.maxWallMs === null ? Number.POSITIVE_INFINITY : started + options.maxWallMs;
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
      model: () => model.model,
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

    const loops: LoopResult[] = [];
    let stop: RunReport["stop"] = "interrupted";
    let reason: string | null = null;
    let record = initialRecord(options.task);
    let handoff: string | null = null;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const spent = loops.reduce(
          (sum, one) => sum + one.usage.inputTokens + one.usage.outputTokens,
          0,
        );
        const loop = await runLoop({
          task: options.task,
          model,
          chokepoint,
          evidence,
          instructions: rendered,
          record,
          status: () => gitText(workspace, ["status", "--short", "--", ".", ":(exclude).swarm"]),
          verify: verifier.tree,
          maxSteps: options.maxSteps - loops.reduce((sum, one) => sum + one.steps, 0),
          maxTokens: options.maxTokens - spent,
          turnTokens: options.turnTokens,
          timeLeft: () => Date.now() + verifier.reserveMs() < deadline,
          contextTokens: options.contextTokens,
          outputs: { directory: join(workspace, ".swarm", "outputs"), root: workspace },
          handoff,
          signal: options.signal,
          log: options.log,
        });
        loops.push(loop);
        ({ stop, reason, record } = loop);
        const stronger = options.escalation ?? null;
        if (attempt > 0 || stronger === null || !modelRelated.has(loop.stop)) break;
        options.log(`escalating from ${model.model} to ${stronger.model}: ${loop.stop}`);
        await evidence.record({
          type: "model-error",
          actor: "harness",
          provenance: ["tool-output"],
          payload: {
            escalation: {
              from: model.model,
              to: stronger.model,
              because: loop.stop,
              reason: loop.reason,
            },
          },
        });
        model = stronger;
        handoff = `Another model worked on this task before you and stopped (${loop.stop}: ${loop.reason ?? "no reason given"}). The working tree holds its changes; check them before building on them.${loop.verification === null ? "" : `\n\nThe verifier's latest findings:\n${loop.verification.feedback}`}`;
      }
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
      record,
      held: verifier.held(),
      cannotVerify:
        stop === "cancelled"
          ? "the run was cancelled"
          : Date.now() >= deadline
            ? "the run's time budget was spent"
            : null,
      verify: (snapshot) => verifier.snapshot(snapshot, record, join(final, "verification")),
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
      loops,
      digests,
      notes: [
        ...instructions.notes,
        ...(options.behaviorChange === "authorized" ? [behaviorChangeNote(finalized.result)] : []),
      ],
      start: managed.start,
      delivery,
      startedAt: started,
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
