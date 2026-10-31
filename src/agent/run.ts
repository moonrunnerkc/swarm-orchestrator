import { createHash } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  requestVersion,
  snapshotWorkingTree,
  type VerifyResult,
  verifierVersion,
  verify,
} from "swarm-verify";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import {
  type ApprovalMode,
  type ConfirmationPrompt,
  createChokepoint,
} from "../tools/chokepoint.ts";
import { createPolicyGuard, defaultShellAllowlist } from "../tools/policy-guard.ts";
import { feedbackOf } from "./feedback.ts";
import { finalize, type HeldResult, type Snapshot } from "./finalize.ts";
import { gitText } from "./git.ts";
import { loadInstructions, renderInstructions } from "./instructions.ts";
import { type LoopResult, runLoop, type StopReason, type Verification } from "./loop.ts";
import type { ModelClient } from "./model.ts";
import { systemPrompt } from "./prompt.ts";
import { type RunReportFile, reportVersion, writeReport } from "./report.ts";
import { initialRecord, type RequirementRecord, recordSha256 } from "./requirement-record.ts";

export interface RunOptions {
  readonly workspace: string;
  readonly task: string;
  readonly model: ModelClient;
  /** Why this model, in one line, for the report. */
  readonly modelReason: string;
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly turnTokens: number;
  /** One wall-time budget for the whole run, final verification included; null for none. */
  readonly maxWallMs: number | null;
  readonly approval: ApprovalMode;
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

/** Where sessions, baselines and sealed checks live: SWARM_HOME, or ~/.swarm. */
export function swarmHome(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.SWARM_HOME ?? join(homedir(), ".swarm");
}

const installable = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "uv.lock",
];

/**
 * Dependencies are installed fresh from the lockfile where the repository has one the verifier
 * installs from, so results are reproducible and upgrades are judged on their own lockfile.
 * Without one, the workspace's installed tree is linked, which the result reports as not
 * reproducible.
 */
export async function dependencyPolicy(workspace: string): Promise<"prepare" | "linked"> {
  const found = await Promise.all(
    installable.map((name) =>
      access(join(workspace, name)).then(
        () => true,
        () => false,
      ),
    ),
  );
  return found.some(Boolean) ? "prepare" : "linked";
}

/** Time held back for final verification before the first one has been timed. */
const defaultVerificationReserveMs = 120_000;

/** Runs the loop on a workspace and finalizes the tree it leaves, whatever ends the loop. */
export async function runAgent(options: RunOptions): Promise<RunReport> {
  const started = Date.now();
  const workspace = await gitText(options.workspace, ["rev-parse", "--show-toplevel"]);
  const base = await gitText(workspace, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const home = swarmHome();
  const evidence = await openEvidenceSession({
    root: join(home, "sessions"),
    sessionId: createSessionId(Date.now()),
    now: Date.now,
  });
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
  const dependencies = await dependencyPolicy(workspace);
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
      promptSha256,
      instructions: digests,
      instructionNotes: instructions.notes,
    },
  });

  let held: HeldResult | null = null;
  let reserveMs = defaultVerificationReserveMs;
  const deadline =
    options.maxWallMs === null ? Number.POSITIVE_INFINITY : started + options.maxWallMs;
  const verifySnapshot = async (
    snapshot: Snapshot,
    record: RequirementRecord,
    directory: string,
  ): Promise<VerifyResult> => {
    const began = Date.now();
    const result = await verify(
      {
        version: requestVersion,
        repository: workspace,
        base: { commit: base },
        candidate: { kind: "patch", path: snapshot.path, sha256: snapshot.sha256 },
        requirements: [...record.requirements],
        policy: { execution: { mode: "host", network: "open", dependencies } },
        artifacts: { directory },
        producer: {
          name: "swarm-orchestrator",
          version: options.version,
          model: options.model.model,
          promptSha256,
          reportSha256: recordSha256(record),
          instructions: digests,
        },
      },
      { verifierVersion, ...(options.signal === undefined ? {} : { signal: options.signal }) },
    );
    // The next reservation is what the last verification took, with room to spare.
    reserveMs = Math.max(30_000, Math.ceil((Date.now() - began) * 1.5));
    held = { patchSha256: snapshot.sha256, recordSha256: recordSha256(record), result };
    return result;
  };
  let judged = 0;
  const verifyTree = async (record: RequirementRecord): Promise<Verification> => {
    judged += 1;
    const directory = join(evidence.directory, "verifications", String(judged));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const snapshot = await snapshotWorkingTree(workspace, base, join(directory, "candidate.patch"));
    const result = await verifySnapshot(snapshot, record, directory);
    return {
      state: result.state,
      patchSha256: snapshot.sha256,
      recordSha256: recordSha256(record),
      feedback: feedbackOf(result),
    };
  };

  let loop: LoopResult | null = null;
  let stop: RunReport["stop"];
  let reason: string | null = null;
  let record = initialRecord(options.task);
  try {
    loop = await runLoop({
      task: options.task,
      model: options.model,
      chokepoint: createChokepoint({
        guard,
        evidence,
        approval: options.approval,
        confirm: options.confirm,
        timeoutMs: 600_000,
        signal: options.signal,
      }),
      evidence,
      instructions: rendered,
      record,
      status: () => gitText(workspace, ["status", "--short", "--", ".", ":(exclude).swarm"]),
      verify: verifyTree,
      maxSteps: options.maxSteps,
      maxTokens: options.maxTokens,
      turnTokens: options.turnTokens,
      timeLeft: () => Date.now() + reserveMs < deadline,
      signal: options.signal,
      log: options.log,
    });
    ({ stop, reason, record } = loop);
  } catch (error) {
    stop = options.signal?.aborted ? "cancelled" : "interrupted";
    reason = error instanceof Error ? error.message : String(error);
  }

  options.log("finalizing the delivered tree");
  const final = await finalize({
    workspace,
    base,
    directory: join(evidence.directory, "final"),
    record,
    held,
    cannotVerify:
      stop === "cancelled"
        ? "the run was cancelled"
        : Date.now() >= deadline
          ? "the run's time budget was spent"
          : null,
    verify: (snapshot) =>
      verifySnapshot(snapshot, record, join(evidence.directory, "final", "verification")),
  });
  const result = final.result;
  const report: RunReportFile = {
    version: reportVersion,
    task: options.task,
    model: { name: options.model.model, reason: options.modelReason },
    stop,
    reason,
    state: final.state,
    snapshot: {
      base,
      patchSha256: final.snapshot.sha256,
      patch: final.snapshot.path,
      treeSha256: result?.snapshot.treeSha256 ?? null,
    },
    verification: final.verification,
    requirements: final.requirements,
    regression:
      result === null
        ? null
        : `${result.regression.status}${result.regression.inherited.length > 0 ? ` (${result.regression.inherited.length} inherited failure(s))` : ""}`,
    execution: result?.execution.statement ?? null,
    attestation: result?.evidence.bundle ?? null,
    instructions: digests,
    notes: [...instructions.notes, ...final.notes],
    resources: {
      steps: loop?.steps ?? 0,
      tokens: loop?.tokens ?? 0,
      estimatedTurns: loop?.estimatedTurns ?? 0,
      verifications: loop?.verifications ?? 0,
      wallMs: Date.now() - started,
    },
  };
  const paths = await writeReport(join(evidence.directory, "final"), report);
  await evidence.record({
    type: "session-stopped",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      stop,
      reason,
      state: final.state,
      patchSha256: final.snapshot.sha256,
      verification: final.verification,
      report: paths.json,
    },
  });
  return { stop, report, sessionDirectory: evidence.directory, reportPath: paths.markdown, result };
}
