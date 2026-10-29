import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import {
  type ApprovalMode,
  type ConfirmationPrompt,
  createChokepoint,
} from "../tools/chokepoint.ts";
import { createPolicyGuard, defaultShellAllowlist } from "../tools/policy-guard.ts";
import { gitText } from "../verify/change.ts";
import { writeAttestation } from "../verify/dsse.ts";
import { swarmHome } from "../verify/held-out.ts";
import { resolveSigningKey } from "../verify/signing.ts";
import { verifyChange } from "../verify/verify.ts";
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
  const verify = async (): Promise<Verification> => {
    const outcome = await verifyChange({
      workspace,
      request: { kind: "working-tree", base },
      producer: { model: options.model.model, promptSha256 },
      version: options.version,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const written = await writeAttestation(
      outcome.statement,
      outcome.patch,
      join(workspace, ".swarm", "verify"),
      { sigstore: false, resolveKey: () => resolveSigningKey() },
    );
    attestation = written.bundle;
    const predicate = outcome.statement.predicate;
    const feedback = [...predicate.reasons, outcome.failureText].filter(Boolean).join("\n\n");
    const mutant = predicate.mutation;
    const survivedMutant = mutant.status === "survived" ? `${mutant.path}:${mutant.line}` : null;
    const inherited = predicate.checks.some((check) => check.result === "pre-existing-failure");
    const actionable = predicate.verdict === "fail" || inherited;
    const reasons = predicate.reasons.join("\n");
    return { verdict: predicate.verdict, feedback, survivedMutant, actionable, reasons };
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
    verify,
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
      verdict: result.verification?.verdict ?? null,
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
