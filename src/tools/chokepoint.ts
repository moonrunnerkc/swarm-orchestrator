import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { runProcessGroup } from "swarm-verify/execution";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { applyFileEdit, editText, type FileEdit } from "./file-edit.ts";
import type { PolicyGuard } from "./policy-guard.ts";
import { refusedAction } from "./refused-actions.ts";
import { readShellPipeline } from "./shell-command.ts";
import { pathsWhereTheyRun } from "./working-directories.ts";

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
  /**
   * A command the harness itself runs (an authored check, a regression check), on the same
   * ledger, environment and process groups as the model's, recorded as the harness's. The model
   * never writes it, so neither the allowlist nor an approval applies.
   */
  check(command: string, purpose: string): Promise<ShellOutcome>;
  /** One file edit block, under the same path policy and on the same ledger as a command. */
  edit(edit: FileEdit): Promise<ShellOutcome>;
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

const onlyComments = (command: string) =>
  command.split("\n").every((line) => line.trim() === "" || line.trim().startsWith("#"));

const nothingToRun =
  "the command holds only comments, so there is nothing to run. Reply with a command that acts.";

const unreadable =
  "this command cannot be read without running a shell (a substitution such as $(...), an expansion, a subshell, a brace group, a program handed to a shell, or a cd to somewhere other than one named directory), so the paths it opens cannot be checked. Run the inner command on its own and write its result into the next command literally.";

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

  // The request is on the ledger before anything happens; what settles it is recorded after.
  const open = async (
    tool: string,
    request: Record<string, string>,
    by: "model" | "harness" = "model",
  ) => {
    calls += 1;
    const callId = `call-${calls}`;
    await options.evidence.record({
      type: "tool-call",
      actor: "harness",
      provenance: [by],
      payload: { callId, tool, decision: "requested", ...request },
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
        provenance: [by, "tool-output"],
        payload: { callId, tool, decision, ...request, output, exitCode, ...detail },
      });
      return { decision, output, exitCode, record: recorded.record.payloadDigest };
    };
    return { callId, settle };
  };

  return {
    async edit(edit: FileEdit): Promise<ShellOutcome> {
      const { settle } = await open(edit.mode, { path: edit.path, command: editText(edit) });
      if (options.signal?.aborted) return settle("failed", "cancelled before the edit", null);
      const verdict = options.guard.checkPath(edit.path);
      if (!verdict.allowed) return settle("denied", `denied: ${verdict.reason}`, null);
      const result = await applyFileEdit(verdict.absolutePath, edit).catch((error: unknown) => ({
        applied: false as const,
        refused: error instanceof Error ? error.message : String(error),
      }));
      if (!result.applied) return settle("failed", `not applied: ${result.refused}`, null);
      return settle("allowed", result.summary, 0, {
        beforeSha256: result.before === null ? null : sha256(result.before),
        afterSha256: sha256(result.after),
      });
    },

    async check(command: string, purpose: string): Promise<ShellOutcome> {
      const { settle } = await open("harness-check", { command, purpose }, "harness");
      if (options.signal?.aborted) return settle("failed", "cancelled before execution", null);
      return execute(command, settle);
    },

    async run(command: string): Promise<ShellOutcome> {
      const { callId, settle } = await open("bash", { command });

      if (options.signal?.aborted) return settle("failed", "cancelled before execution", null);
      const pipeline = readShellPipeline(command);
      const refused = pipeline === null ? null : refusedAction(pipeline);
      if (refused !== null) return settle("denied", `denied: ${refused}`, null);
      const root = options.guard.workspaceRoot;
      const paths = pathsWhereTheyRun(command, (path) => isDirectory(resolve(root, path)));
      // A string the reader cannot read names paths nothing here checked. A person may still run
      // it; auto approval has nobody to judge it, so it is refused rather than run unchecked.
      if (paths === null && options.approval === "auto") {
        return settle(
          "denied",
          `denied: ${onlyComments(command) ? nothingToRun : unreadable}`,
          null,
        );
      }
      for (const path of paths ?? []) {
        const verdict = options.guard.checkPath(path);
        if (!verdict.allowed) return settle("denied", `denied: ${verdict.reason}`, null);
      }
      if (paths === null || !options.guard.isCommandAllowed(command)) {
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
      return execute(command, settle);
    },
  };

  async function execute(command: string, settle: Settle): Promise<ShellOutcome> {
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
  }
}

type Settle = (
  decision: ShellOutcome["decision"],
  output: string,
  exitCode: number | null,
  detail?: Record<string, string | number | boolean | null>,
) => Promise<ShellOutcome>;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
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
