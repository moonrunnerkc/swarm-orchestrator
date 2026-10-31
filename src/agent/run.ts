import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { requestVersion, snapshotWorkingTree, verifierVersion, verify } from "swarm-verify";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import {
  type ApprovalMode,
  type ConfirmationPrompt,
  createChokepoint,
} from "../tools/chokepoint.ts";
import { createPolicyGuard, defaultShellAllowlist } from "../tools/policy-guard.ts";
import { gitText } from "./git.ts";
import { type LoopResult, runLoop, type Verification } from "./loop.ts";
import type { ModelClient } from "./model.ts";
import { systemPrompt } from "./prompt.ts";

export interface RunOptions {
  readonly workspace: string;
  readonly task: string;
  readonly model: ModelClient;
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly turnTokens: number;
  readonly approval: ApprovalMode;
  readonly confirm: ConfirmationPrompt;
  readonly version: string;
  readonly signal?: AbortSignal | undefined;
  readonly log: (line: string) => void;
}

export interface RunReport extends LoopResult {
  readonly sessionDirectory: string;
  readonly attestation: string | null;
}

/** Where sessions, baselines and sealed checks live: SWARM_HOME, or ~/.swarm. */
export function swarmHome(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.SWARM_HOME ?? join(homedir(), ".swarm");
}

/** Runs the loop on a workspace, judged by the verifier against the commit it started from. */
export async function runAgent(options: RunOptions): Promise<RunReport> {
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
    // The session store and the sealed held-out checks are never the agent's to read.
    deniedRoots: [home],
    childHomeDir: childHome,
  });
  const promptSha256 = createHash("sha256")
    .update(`${systemPrompt}\n${options.task}`)
    .digest("hex");
  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: { task: options.task, model: options.model.model, base, promptSha256 },
  });

  let attestation: string | null = null;
  let judged = 0;
  // Each verification gets its own directory in the session, outside the workspace and out of
  // the agent's reach, and judges an immutable snapshot of the working tree.
  const verifyTree = async (): Promise<Verification> => {
    judged += 1;
    const directory = join(evidence.directory, "verifications", String(judged));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const snapshot = await snapshotWorkingTree(workspace, base, join(directory, "candidate.patch"));
    const result = await verify(
      {
        version: requestVersion,
        repository: workspace,
        base: { commit: base },
        candidate: { kind: "patch", path: snapshot.path, sha256: snapshot.sha256 },
        policy: { execution: { mode: "host", network: "open", dependencies: "linked" } },
        artifacts: { directory },
        producer: {
          name: "swarm-orchestrator",
          version: options.version,
          model: options.model.model,
          promptSha256,
        },
      },
      {
        verifierVersion,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    attestation = result.evidence.bundle;
    const feedback = [...result.reasons, result.failureOutput].filter(Boolean).join("\n\n");
    const mutant = result.mutation;
    const survivedMutant = mutant.status === "survived" ? `${mutant.path}:${mutant.line}` : null;
    const failed = result.regression.status === "found" || !result.change.applied;
    const inherited =
      result.regression.inherited.length > 0 || result.regression.unresolved.length > 0;
    return {
      state: result.state,
      failed,
      feedback,
      survivedMutant,
      actionable: failed || inherited,
      reasons: result.reasons.join("\n"),
    };
  };

  const result = await runLoop({
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
    status: () => gitText(workspace, ["status", "--short", "--", ".", ":(exclude).swarm"]),
    verify: verifyTree,
    maxSteps: options.maxSteps,
    maxTokens: options.maxTokens,
    turnTokens: options.turnTokens,
    signal: options.signal,
    log: options.log,
  });
  await evidence.record({
    type: "session-stopped",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      stop: result.stop,
      reason: result.reason,
      state: result.verification?.state ?? null,
      steps: result.steps,
      // tokensUsed, not tokens: the scrubber reads a bare `tokens` key as a credential.
      tokensUsed: result.tokens,
      estimatedTurns: result.estimatedTurns,
      verifications: result.verifications,
      attestation,
    },
  });
  return { ...result, sessionDirectory: evidence.directory, attestation };
}
