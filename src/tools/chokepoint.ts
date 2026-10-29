import type { EvidenceRecorder } from "../evidence/session.ts";
import { runProcessGroup } from "../exec/run-process.ts";
import type { PolicyGuard } from "./policy-guard.ts";
import { readShellCommand } from "./shell-command.ts";

/** Whether an off-allowlist command is answered by the run (auto) or by a person (ask). */
export type ApprovalMode = "ask" | "auto";

export interface ConfirmationRequest {
  readonly command: string;
  /** The off-list programs an "always" would allow for the rest of the run. */
  readonly programs: readonly string[];
  readonly explanation: string;
}

export type ConfirmationAnswer = "yes" | "no" | "always";

/** Asked when a command needs a person; null where nobody is there to ask. */
export type ConfirmationPrompt =
  | ((request: ConfirmationRequest) => Promise<ConfirmationAnswer>)
  | null;

export interface ShellOutcome {
  readonly decision: "allowed" | "denied" | "failed";
  readonly output: string;
  readonly exitCode: number | null;
  /** The payload digest of the outcome record. */
  readonly record: string;
}

export interface Chokepoint {
  run(command: string): Promise<ShellOutcome>;
}

export interface ChokepointOptions {
  readonly guard: PolicyGuard;
  readonly evidence: EvidenceRecorder;
  readonly approval: ApprovalMode;
  readonly confirm: ConfirmationPrompt;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

const maxOutputBytes = 4 * 1024 * 1024;

/**
 * The single way a command the model wrote runs. The request is on the ledger before anything
 * happens, every path a shell word could open goes through the guard, an off-allowlist program
 * is answered by the approval mode, a person or nobody (a refusal), and the outcome is recorded
 * after. A failed ledger write throws and ends the run: unrecorded execution is what this exists
 * to prevent. Denials come back as outcomes, because the model reads them.
 */
export function createChokepoint(options: ChokepointOptions): Chokepoint {
  const allowance = new Set<string>();
  let calls = 0;

  return {
    async run(command: string): Promise<ShellOutcome> {
      calls += 1;
      const callId = `call-${calls}`;
      await options.evidence.record({
        type: "tool-call",
        actor: "harness",
        provenance: ["model"],
        payload: { callId, tool: "bash", decision: "requested", command },
      });
      const settle = async (
        decision: ShellOutcome["decision"],
        output: string,
        exitCode: number | null,
        detail: Record<string, string | number | boolean | null> = {},
      ): Promise<ShellOutcome> => {
        const recorded = await options.evidence.record({
          type: "tool-call",
          actor: "harness",
          provenance: ["model", "tool-output"],
          payload: { callId, tool: "bash", decision, command, output, exitCode, ...detail },
        });
        return { decision, output, exitCode, record: recorded.record.payloadDigest };
      };

      if (options.signal?.aborted) return settle("failed", "cancelled before execution", null);
      for (const path of readShellCommand(command)?.operands ?? []) {
        const verdict = options.guard.checkPath(path);
        if (!verdict.allowed) return settle("denied", `denied: ${verdict.reason}`, null);
      }
      if (!options.guard.isCommandAllowed(command)) {
        const programs = options.guard.disallowedExecutables(command) ?? [];
        const answer = await decide(options, allowance, { command, programs, explanation: "" });
        await options.evidence.record({
          type: "confirmation",
          actor: "harness",
          provenance: [answer.decidedBy === "user" ? "user" : "model"],
          payload: { callId, command, programs: [...programs], ...answer },
        });
        if (answer.outcome === "declined") {
          return settle(
            "denied",
            `denied: ${programs.length > 0 ? programs.join(", ") : "this command"} is not on the shell allowlist and was not approved`,
            null,
          );
        }
      }
      const ran = await runProcessGroup("/bin/sh", ["-c", command], {
        cwd: options.guard.workspaceRoot,
        env: options.guard.childEnvironment.variables,
        timeoutMs: options.timeoutMs,
        maxOutputBytes,
        signal: options.signal,
      });
      const output = `${ran.stdout}${ran.stderr}${ran.timedOut ? "\n[timed out]" : ""}`;
      if (ran.startFailure !== null) return settle("failed", ran.startFailure, null);
      return settle("allowed", output, ran.exitCode, {
        timedOut: ran.timedOut,
        truncated: ran.truncated,
      });
    },
  };
}

async function decide(
  options: ChokepointOptions,
  allowance: Set<string>,
  request: ConfirmationRequest,
): Promise<{ outcome: "approved" | "declined" | "pre-approved"; decidedBy: string }> {
  if (options.approval === "auto") return { outcome: "pre-approved", decidedBy: "approval-mode" };
  const { programs } = request;
  if (programs.length > 0 && programs.every((program) => allowance.has(program))) {
    return { outcome: "pre-approved", decidedBy: "run-allowance" };
  }
  if (options.confirm === null) return { outcome: "declined", decidedBy: "nobody to ask" };
  const answer = await options.confirm({
    ...request,
    explanation: `"${request.command}" runs a program that is not on the shell allowlist.`,
  });
  if (answer === "always") for (const program of programs) allowance.add(program);
  return { outcome: answer === "no" ? "declined" : "approved", decidedBy: "user" };
}
